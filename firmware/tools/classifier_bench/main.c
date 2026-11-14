// classifier_bench: runs the classifier on the board and reports over USB serial. The other
// end is model/board_test.py.
//
// Each time a program opens the port it prints a report, one "key value..." line each:
//     init ok|failed
//     arena <bytes used> <bytes reserved>
//     heap <bytes the feature tables took>
//     pattern <n> <5 scores, 0-255>     model output for fixed test input n (see fill_pattern)
//     infer_us <min> <mean> <max>       over INFER_RUNS model runs
//     features_us <per 20 ms frame>     feature extraction, averaged over 1 s of noise
//     live
// and then, from the mic, one line per 240 ms step and one per detection:
//     w <level, tenths of dB> <ran model 0|1> <infer us> <5 scores>
//     alert <class_id> <confidence> <peak_level> <blast_count>

#include <malloc.h>
#include <stdint.h>
#include <stdio.h>

#include "pico/stdio_usb.h"
#include "pico/stdlib.h"

#include "classifier.h"
#include "mic.h"

// docs/classifier-interface.md: SD -> GP2, SCK -> GP3, WS -> GP4.
#define PIN_SD 2
#define PIN_SCK 3

#define PATTERNS 4
#define INFER_RUNS 20
#define FEATURE_BYTES (49 * 40)

static uint32_t lcg_state;

static uint32_t lcg(void) {
	lcg_state = lcg_state * 1664525u + 1013904223u;
	return lcg_state;
}

// Fixed test inputs. model/board_test.py builds the same ones; keep the two in step.
//   0: silence   1: random bytes   2: random, quiet (0-63)
//   3: quiet (0-31) with a loud band across channels 20-22, like a steady tone
static void fill_pattern(int n, uint8_t *features) {
	lcg_state = 1u + (uint32_t)n;
	for (int i = 0; i < FEATURE_BYTES; i++) {
		uint8_t r = (uint8_t)(lcg() >> 24);
		int channel = i % 40;
		switch (n) {
		case 0:
			features[i] = 0;
			break;
		case 1:
			features[i] = r;
			break;
		case 2:
			features[i] = r & 0x3F;
			break;
		default:
			features[i] = channel >= 20 && channel <= 22 ? 220 : (r & 0x1F);
			break;
		}
	}
}

static void report(bool ok, size_t heap_used) {
	static uint8_t features[FEATURE_BYTES];
	static int32_t noise[256];
	classifier_stats_t stats;
	uint8_t scores[5];

	printf("init %s\n", ok ? "ok" : "failed");
	if (!ok) {
		return;
	}
	classifier_get_stats(&stats);
	printf("arena %lu %lu\n", (unsigned long)stats.arena_used, (unsigned long)stats.arena_size);
	printf("heap %u\n", (unsigned)heap_used);

	for (int n = 0; n < PATTERNS; n++) {
		fill_pattern(n, features);
		classifier_infer_features(features, scores);
		printf("pattern %d %u %u %u %u %u\n", n, scores[0], scores[1], scores[2], scores[3],
			   scores[4]);
	}

	uint32_t lo = UINT32_MAX, hi = 0, sum = 0;
	fill_pattern(1, features);
	for (int i = 0; i < INFER_RUNS; i++) {
		classifier_infer_features(features, scores);
		classifier_get_stats(&stats);
		uint32_t us = stats.last_infer_us;
		lo = us < lo ? us : lo;
		hi = us > hi ? us : hi;
		sum += us;
	}
	printf("infer_us %lu %lu %lu\n", (unsigned long)lo, (unsigned long)(sum / INFER_RUNS),
		   (unsigned long)hi);

	// One second of noise at about -40 dBFS: 50 frames.
	lcg_state = 99;
	uint32_t t0 = time_us_32();
	for (int block = 0; block < 16000 / 256; block++) {
		for (int i = 0; i < 256; i++) {
			noise[i] = (int32_t)(lcg() >> 15) - 65536;
		}
		classifier_push(noise, 256);
	}
	printf("features_us %lu\n", (unsigned long)((time_us_32() - t0) / 50));
	printf("live\n");
}

int main(void) {
	static int32_t samples[256];
	classifier_result_t result;
	classifier_stats_t stats;
	uint32_t windows = 0, inferences = 0;
	bool connected = false;

	stdio_init_all();

	size_t heap_before = mallinfo().uordblks;
	bool ok = classifier_init(0);
	size_t heap_used = mallinfo().uordblks - heap_before;
	mic_init(PIN_SD, PIN_SCK);

	while (true) {
		if (stdio_usb_connected() != connected) {
			connected = !connected;
			if (connected) {
				sleep_ms(200); // let the PC finish opening the port
				report(ok, heap_used);
				// The report fed the classifier test audio: start the live part clean.
				ok = classifier_init(0);
				while (mic_read(samples, 256) > 0) {
				}
				classifier_get_stats(&stats);
				windows = stats.windows;
				inferences = stats.inferences;
			}
		}

		size_t n = mic_read(samples, 256);
		if (n == 0) {
			sleep_us(500);
			continue;
		}
		classifier_push(samples, n);
		bool alert = classifier_poll(&result);

		classifier_get_stats(&stats);
		if (connected && stats.windows != windows) {
			bool ran = stats.inferences != inferences;
			printf("w %d %d %lu %u %u %u %u %u\n", stats.level, ran,
				   ran ? (unsigned long)stats.last_infer_us : 0ul, stats.scores[0], stats.scores[1],
				   stats.scores[2], stats.scores[3], stats.scores[4]);
		}
		windows = stats.windows;
		inferences = stats.inferences;
		if (connected && alert) {
			printf("alert %u %u %d %u\n", result.class_id, result.confidence, result.peak_level,
				   result.blast_count);
		}
	}
}
