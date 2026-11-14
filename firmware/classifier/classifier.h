// The Serra classifier: mic samples in, alerts out.
//
// Wraps the feature code (features.h), the int8 model (model_data.h) and TensorFlow Lite
// Micro behind a plain C API, so firmware never touches C++ or the model's tensors.
// See docs/classifier-interface.md.
//
// Call everything from one core. Nothing here blocks; classifier_poll() runs at most one
// inference per call.
//
//     classifier_init(calib);
//     for (;;) {
//         size_t n = mic_read(samples, MAX);
//         classifier_push(samples, n);
//         classifier_result_t r;
//         if (classifier_poll(&r)) { /* send the alert */ }
//     }

#ifndef SERRA_CLASSIFIER_H
#define SERRA_CLASSIFIER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CLASS_WHISTLE 1
#define CLASS_SCREAM 2
#define CLASS_HELP 3

// One detected event. Fields match alert_payload_t (project README, Mesh protocol).
typedef struct {
	uint8_t class_id;	 // CLASS_WHISTLE, CLASS_SCREAM or CLASS_HELP
	uint8_t confidence;	 // 0-255: the model's best score for that class during the event
	int16_t peak_level;	 // tenths of a dB: loudest moment in dBFS plus the calibration offset
	uint8_t blast_count; // whistles: blasts heard in the event (3 = distress). Otherwise 0
} classifier_result_t;

// Call once at boot. `calib_offset_db_x10` is this node's calibration offset in tenths of a
// dB, added to every peak_level. Returns false if the model can't be loaded (wrong format,
// arena too small, out of heap for the feature tables).
bool classifier_init(int16_t calib_offset_db_x10);

// Feeds mic audio as it arrives: 16 kHz, signed 24-bit samples in int32_t, as mic_read()
// returns them. Computes features as it goes; does not run the model.
void classifier_push(const int32_t *samples24, size_t n);

// Call often. Runs the model when ~240 ms of new audio has arrived and the audio is loud
// enough to bother (the wake trigger). Returns true once per detected event, with *out
// filled in. An event is reported when it ends, roughly 1.5 s after the sound stops, so
// that its peak level and blast count cover the whole of it; a sound that keeps going is
// reported every few seconds.
bool classifier_poll(classifier_result_t *out);

// ---- Measurement and test hooks. Not needed by the node firmware. ----

typedef struct {
	uint32_t arena_size;	// bytes reserved for TFLM's working memory
	uint32_t arena_used;	// bytes of it the model needs
	uint32_t inferences;	// model runs since init
	uint32_t windows;		// 240 ms steps since init (inferences + steps skipped as quiet)
	uint32_t last_infer_us; // duration of the latest model run
	uint8_t scores[5];		// latest scores, 0-255, in model_data.h order
	int16_t level;			// peak level of the latest 240 ms, tenths of a dB, calibrated
} classifier_stats_t;

void classifier_get_stats(classifier_stats_t *out);

// Runs the model on a given feature window (49 x 40 bytes, oldest frame first) instead of
// the live audio, for checking the board against the PC. Returns false if the model failed.
bool classifier_infer_features(const uint8_t *features, uint8_t scores[5]);

#ifdef __cplusplus
}
#endif

#endif // SERRA_CLASSIFIER_H
