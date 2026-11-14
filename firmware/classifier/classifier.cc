// See classifier.h.

#include "classifier.h"

#include <math.h>
#include <new>
#include <string.h>

#include "pico/time.h"

#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/schema/schema_generated.h"

#include "features.h"
#include "model_data.h"

namespace {

// ---- Tuning ----

// TFLM's working memory. The model needs CLASSIFIER_ARENA_USED of it (measured on a
// Pico 2 W by tools/classifier_bench); the rest is margin for a retrained model.
constexpr size_t kArenaBytes = 48 * 1024;

// Frames between inferences: 12 x 20 ms = 240 ms. model/predict.py and stream_test.py use
// the same step, so their numbers describe what the board does.
constexpr int kHopFrames = 12;

// Wake trigger: run the model only when the newest 240 ms peaked above this, on the mic's
// 24-bit scale. -60 dBFS is 6 dB under the quietest sound the model was trained on
// (model/dataset.py: peaks from -42 dBFS after the +12 dB of FEATURES_PCM24_SHIFT).
constexpr uint32_t kWakePeak = 8389; // (1 << 23) * 10^(-60 / 20)

// No inference until this many frames after init (3 s). The feature code needs a couple
// of seconds to learn the noise floor, and training examples always had that lead-in;
// scored earlier, plain room noise can look like a scream.
constexpr uint32_t kWarmupFrames = 150;

// After a loud step keep running the model for this many more, so every 1-second window
// that still contains the sound gets scored.
constexpr int kWakeHoldHops = 4;

// An event ends after this many steps in a row without an alert window.
constexpr int kEndHops = 2;

// A sound that keeps going is reported after this many steps and a new event starts.
// Whistles get longer so a three-blast call is counted in one piece.
constexpr int kMaxEventHops = 12;		 // ~3 s
constexpr int kMaxWhistleEventHops = 32; // ~8 s

// Blast counting, on the loudest filterbank channel of each 20 ms frame. Tuned on
// synthetic whistles only: a blast starts at kBlastOn, and is over once the channel has
// stayed under kBlastOff for kBlastGapFrames. Shorter than kBlastMinFrames is a click.
constexpr uint8_t kBlastOn = 170;
constexpr uint8_t kBlastOff = 130;
constexpr int kBlastGapFrames = 4;
constexpr int kBlastMinFrames = 5;
constexpr int kBlastHistory = 8;

// Level meter high-pass: two one-pole stages at fs / (2 * pi * 2^4), about 160 Hz. Room
// rumble below the filterbank's 125 Hz edge is often the loudest thing the mic hears; it
// must not trip the wake trigger or set peak_level.
constexpr int kLevelShift = 4;

constexpr int kFrames = SERRA_MODEL_INPUT_FRAMES;
constexpr int kChannels = SERRA_MODEL_INPUT_CHANNELS;
constexpr int kAlertClasses = SERRA_MODEL_ALERT_CLASSES;
constexpr uint8_t kThresholds[kAlertClasses] = SERRA_MODEL_THRESHOLDS;

static_assert(kFrames == FEATURES_FRAMES && kChannels == FEATURES_CHANNELS,
			  "model input does not match the feature code");
static_assert(SERRA_MODEL_CLASSES == 5, "classifier_stats_t holds 5 scores");

// ---- State ----

alignas(16) uint8_t arena[kArenaBytes];
tflite::MicroInterpreter *interpreter;
int8_t *model_input;
const int8_t *model_output;

// The newest kFrames feature frames; frame_next is the oldest and the next overwritten.
uint8_t frames[kFrames][kChannels];
int frame_next;
uint32_t frames_total;
int frames_since_hop;

// Level meter.
int32_t hp_in[2], hp_out[2];
uint32_t hop_peak;					   // loudest sample since the last step
uint32_t recent_peaks[kWakeHoldHops];  // per step, newest kWakeHoldHops steps
int wake_hold;
int16_t calib_offset;

// Blast detector.
bool blast_on, blast_logged;
int blast_frames, blast_quiet;
uint32_t blast_ends[kBlastHistory]; // frame index where each recent blast was last heard
int blast_next;

// The event in progress, if any.
bool event_active;
uint8_t event_best[kAlertClasses]; // best score per alert class
uint32_t event_peak;
uint32_t event_first_frame; // first frame of the first alert window
int event_hops, event_quiet;

classifier_stats_t stats;

int16_t level_db_x10(uint32_t peak) {
	if (peak == 0) {
		peak = 1;
	}
	float db = 20.0f * log10f((float)peak / 8388608.0f);
	return (int16_t)lroundf(db * 10.0f) + calib_offset;
}

// Tracks the loudest sample of the high-passed input.
void level_feed(const int32_t *in, size_t n) {
	for (size_t i = 0; i < n; i++) {
		int32_t x = in[i];
		for (int s = 0; s < 2; s++) {
			int32_t y = x - hp_in[s] + hp_out[s] - (hp_out[s] >> kLevelShift);
			hp_in[s] = x;
			hp_out[s] = y;
			x = y;
		}
		uint32_t mag = (uint32_t)(x < 0 ? -x : x);
		if (mag > hop_peak) {
			hop_peak = mag;
		}
	}
}

void blast_feed(const uint8_t *frame) {
	uint8_t loudest = 0;
	for (int c = 0; c < kChannels; c++) {
		if (frame[c] > loudest) {
			loudest = frame[c];
		}
	}

	if (!blast_on) {
		if (loudest >= kBlastOn) {
			blast_on = true;
			blast_logged = false;
			blast_frames = 1;
			blast_quiet = 0;
		}
		return;
	}
	blast_frames++;
	blast_quiet = loudest < kBlastOff ? blast_quiet + 1 : 0;
	if (blast_quiet >= kBlastGapFrames) {
		blast_on = false;
		return;
	}
	if (blast_quiet > 0) {
		return;
	}
	// Still sounding. Once it is long enough to count, log it and keep its end up to date.
	if (blast_frames < kBlastMinFrames) {
		return;
	}
	if (!blast_logged) {
		blast_logged = true;
		blast_next = (blast_next + 1) % kBlastHistory;
	}
	blast_ends[blast_next] = frames_total;
}

uint8_t blasts_since(uint32_t first_frame) {
	uint8_t count = 0;
	for (int i = 0; i < kBlastHistory; i++) {
		// Frame indices start at 1 here, so 0 marks an unused slot.
		if (blast_ends[i] != 0 && blast_ends[i] >= first_frame) {
			count++;
		}
	}
	return count;
}

bool run_model(uint8_t scores[SERRA_MODEL_CLASSES]) {
	uint32_t t0 = time_us_32();
	if (interpreter->Invoke() != kTfLiteOk) {
		return false;
	}
	stats.last_infer_us = time_us_32() - t0;
	stats.inferences++;
	for (int c = 0; c < SERRA_MODEL_CLASSES; c++) {
		scores[c] = (uint8_t)(model_output[c] + 128);
		stats.scores[c] = scores[c];
	}
	return true;
}

// The alert class (0-based) this window raises, or -1.
int alert_of(const uint8_t scores[SERRA_MODEL_CLASSES]) {
	int top = 0;
	for (int c = 1; c < SERRA_MODEL_CLASSES; c++) {
		if (scores[c] > scores[top]) {
			top = c;
		}
	}
	return top < kAlertClasses && scores[top] >= kThresholds[top] ? top : -1;
}

int event_leader() {
	int best = 0;
	for (int c = 1; c < kAlertClasses; c++) {
		if (event_best[c] > event_best[best]) {
			best = c;
		}
	}
	return best;
}

void event_finish(classifier_result_t *out) {
	int c = event_leader();
	out->class_id = (uint8_t)(c + 1);
	out->confidence = event_best[c];
	out->peak_level = level_db_x10(event_peak);
	out->blast_count = c == SERRA_MODEL_WHISTLE ? blasts_since(event_first_frame) : 0;
	event_active = false;
}

} // namespace

bool classifier_init(int16_t calib_offset_db_x10) {
	static tflite::MicroMutableOpResolver<7> resolver;
	static bool resolver_ready;

	interpreter = nullptr;
	if (!features_init()) {
		return false;
	}

	const tflite::Model *model = tflite::GetModel(serra_model_data);
	if (model->version() != TFLITE_SCHEMA_VERSION) {
		return false;
	}
	// Every op the model uses (model/train.py). RESHAPE is only there in case a future
	// converter stops folding the model's reshape away.
	if (!resolver_ready) {
		if (resolver.AddConv2D() != kTfLiteOk || resolver.AddDepthwiseConv2D() != kTfLiteOk ||
			resolver.AddMaxPool2D() != kTfLiteOk || resolver.AddAveragePool2D() != kTfLiteOk ||
			resolver.AddFullyConnected() != kTfLiteOk || resolver.AddSoftmax() != kTfLiteOk ||
			resolver.AddReshape() != kTfLiteOk) {
			return false;
		}
		resolver_ready = true;
	}

	// Built in place so nothing here runs before main() or touches the heap.
	alignas(tflite::MicroInterpreter) static uint8_t storage[sizeof(tflite::MicroInterpreter)];
	tflite::MicroInterpreter *candidate =
		new (storage) tflite::MicroInterpreter(model, resolver, arena, kArenaBytes);
	if (candidate->AllocateTensors() != kTfLiteOk) {
		return false;
	}

	const TfLiteTensor *in = candidate->input(0);
	const TfLiteTensor *result = candidate->output(0);
	if (in->type != kTfLiteInt8 || in->bytes != (size_t)(kFrames * kChannels) ||
		in->params.zero_point != -128 || result->type != kTfLiteInt8 ||
		result->bytes != SERRA_MODEL_CLASSES || result->params.zero_point != -128) {
		return false;
	}
	model_input = in->data.int8;
	model_output = result->data.int8;
	interpreter = candidate;

	memset(frames, 0, sizeof(frames));
	frame_next = 0;
	frames_total = 0;
	frames_since_hop = 0;
	memset(hp_in, 0, sizeof(hp_in));
	memset(hp_out, 0, sizeof(hp_out));
	hop_peak = 0;
	memset(recent_peaks, 0, sizeof(recent_peaks));
	wake_hold = 0;
	calib_offset = calib_offset_db_x10;
	blast_on = false;
	memset(blast_ends, 0, sizeof(blast_ends));
	blast_next = 0;
	event_active = false;

	memset(&stats, 0, sizeof(stats));
	stats.arena_size = kArenaBytes;
	stats.arena_used = (uint32_t)candidate->arena_used_bytes();
	return true;
}

void classifier_push(const int32_t *samples24, size_t n) {
	int16_t pcm[256];

	if (interpreter == nullptr) {
		return;
	}
	while (n > 0) {
		size_t chunk = n < 256 ? n : 256;
		level_feed(samples24, chunk);
		features_pcm24_to_16(samples24, pcm, chunk);

		size_t done = 0;
		while (done < chunk) {
			size_t used = 0;
			if (features_process(pcm + done, chunk - done, &used, frames[frame_next])) {
				frames_total++;
				blast_feed(frames[frame_next]);
				frame_next = (frame_next + 1) % kFrames;
				frames_since_hop++;
			}
			done += used;
		}
		samples24 += chunk;
		n -= chunk;
	}
}

bool classifier_poll(classifier_result_t *out) {
	if (interpreter == nullptr || frames_since_hop < kHopFrames) {
		return false;
	}
	// One step per call. If audio arrived faster than we were polled, the steps in between
	// are skipped: the newest window is the one worth scoring.
	frames_since_hop = 0;
	stats.windows++;

	uint32_t peak = hop_peak;
	hop_peak = 0;
	stats.level = level_db_x10(peak);
	memmove(recent_peaks, recent_peaks + 1, sizeof(recent_peaks) - sizeof(recent_peaks[0]));
	recent_peaks[kWakeHoldHops - 1] = peak;

	if (peak >= kWakePeak) {
		wake_hold = kWakeHoldHops;
	} else if (wake_hold > 0) {
		wake_hold--;
	}

	int alert = -1;
	uint8_t scores[SERRA_MODEL_CLASSES] = {0};
	if ((wake_hold > 0 || event_active) && frames_total >= kWarmupFrames) {
		// Oldest frame first; a feature byte b goes in as b - 128.
		int8_t *dst = model_input;
		for (int f = 0; f < kFrames; f++) {
			const uint8_t *src = frames[(frame_next + f) % kFrames];
			for (int c = 0; c < kChannels; c++) {
				*dst++ = (int8_t)(src[c] - 128);
			}
		}
		if (run_model(scores)) {
			alert = alert_of(scores);
		}
	}

	if (alert >= 0) {
		if (!event_active) {
			event_active = true;
			memset(event_best, 0, sizeof(event_best));
			event_hops = 0;
			// The window that raised the alert reaches back a second.
			event_first_frame = frames_total - (uint32_t)kFrames + 1;
			event_peak = 0;
			for (int i = 0; i < kWakeHoldHops; i++) {
				if (recent_peaks[i] > event_peak) {
					event_peak = recent_peaks[i];
				}
			}
		}
		if (scores[alert] > event_best[alert]) {
			event_best[alert] = scores[alert];
		}
		event_quiet = 0;
	} else if (event_active) {
		event_quiet++;
	}
	if (!event_active) {
		return false;
	}

	event_hops++;
	if (peak > event_peak) {
		event_peak = peak;
	}
	int limit = event_leader() == SERRA_MODEL_WHISTLE ? kMaxWhistleEventHops : kMaxEventHops;
	if (event_quiet >= kEndHops || event_hops >= limit) {
		event_finish(out);
		return true;
	}
	return false;
}

void classifier_get_stats(classifier_stats_t *out) {
	*out = stats;
}

bool classifier_infer_features(const uint8_t *features, uint8_t scores[5]) {
	if (interpreter == nullptr) {
		return false;
	}
	for (int i = 0; i < kFrames * kChannels; i++) {
		model_input[i] = (int8_t)(features[i] - 128);
	}
	return run_model(scores);
}
