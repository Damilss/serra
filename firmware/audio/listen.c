/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: listen.c
 */
#include "listen.h"

#include <stdint.h>
#include <stdio.h>

#include "classifier.h"
#include "mic.h"
#include "pico/multicore.h"
#include "pico/stdlib.h"
#include "runtime/ipc.h"

/**
 * LISTEN_PIN_SD - INMP441 SD (data) pin
 * LISTEN_PIN_SCK - INMP441 SCK (bit clock) pin; WS is the next pin, GP4
 *
 * per docs/classifier-interface.md: SD -> GP2, SCK -> GP3, WS -> GP4,
 * L/R -> GND, VDD -> 3V3(OUT).
 */
#define LISTEN_PIN_SD 2
#define LISTEN_PIN_SCK 3

/**
 * LISTEN_CALIB_DB_X10 - this node's peak-level calibration, tenths of a dB
 *
 * TODO: per-node offsets from the reference-tone calibration (README "Peak
 * level and calibration"). 0 means peak_level is raw dBFS.
 */
#define LISTEN_CALIB_DB_X10 0

/**
 * LISTEN_CHUNK - samples read from the mic per loop pass (16 ms of audio)
 */
#define LISTEN_CHUNK 256

/**
 * LISTEN_IDLE_US - how long core 1 sleeps when the mic has nothing new
 *
 * the mic's ring buffer holds 256 ms, so a 500 us nap can't lose audio.
 */
#define LISTEN_IDLE_US 500

/**
 * LISTEN_STACK_WORDS - core 1's stack, in 32-bit words (16 KB)
 *
 * the SDK's default core 1 stack is 2 KB. TFLM's call depth during
 * inference isn't documented, so core 1 gets a roomy stack of its own.
 */
#define LISTEN_STACK_WORDS (16 * 1024 / 4)

/**
 * LISTEN_DEBUG - 1 = print the mic's raw peak and the classifier's level once a second
 *
 * for checking mic wiring: a working mic shows a small noise floor that jumps on a
 * clap; a raw_peak stuck at 0 means no audio is arriving (wiring, solder, power).
 * off by default; build with -DLISTEN_DEBUG=1 (e.g. in CMakeLists.txt's
 * target_compile_definitions) to turn it on.
 */
#ifndef LISTEN_DEBUG
#define LISTEN_DEBUG 0
#endif

/**
 * LISTEN_DEBUG_PERIOD_MS - how often the debug line prints
 */
#define LISTEN_DEBUG_PERIOD_MS 1000

static uint32_t core1_stack[LISTEN_STACK_WORDS];

/**
 * debug_level - track the raw peak and print the debug line once a period
 * @samples: the samples just read
 * @n: how many
 *
 * raw_peak is the largest |sample| since the last print, in raw 24-bit units
 * (full scale 8388608), straight from the mic before the classifier.
 */
static void debug_level(const int32_t *samples, size_t n) {
	static int32_t raw_peak;
	static absolute_time_t next_print;
	classifier_stats_t stats;

	for (size_t i = 0; i < n; i++) {
		int32_t a = samples[i] < 0 ? -samples[i] : samples[i];

		if (a > raw_peak)
			raw_peak = a;
	}

	if (!time_reached(next_print))
		return;
	next_print = make_timeout_time_ms(LISTEN_DEBUG_PERIOD_MS);

	classifier_get_stats(&stats);
	printf("[listen] mic raw_peak=%ld level=%d windows=%lu inferences=%lu\n", (long)raw_peak,
		   stats.level, (unsigned long)stats.windows, (unsigned long)stats.inferences);
	raw_peak = 0;
}

/**
 * skip_startup - throw away the mic's first MIC_STARTUP_SAMPLES samples
 * @buf: scratch buffer of LISTEN_CHUNK samples
 *
 * the INMP441 outputs zeros for ~256 ms after its clock starts.
 */
static void skip_startup(int32_t *buf) {
	size_t skipped = 0;

	while (skipped < MIC_STARTUP_SAMPLES) {
		size_t n = mic_read(buf, LISTEN_CHUNK);

		if (n == 0)
			sleep_us(LISTEN_IDLE_US);
		skipped += n;
	}
}

/**
 * post_detection - hand one classifier result to core 0
 * @r: the result from classifier_poll()
 */
static void post_detection(const classifier_result_t *r) {
	ipc_detection_t det = {
		.class_id = r->class_id,
		.confidence = r->confidence,
		.peak_level = r->peak_level,
		.blast_count = r->blast_count,
		.timestamp_ms = to_ms_since_boot(get_absolute_time()),
	};

	printf("[listen] detected class=%u conf=%u peak=%d blasts=%u\n", r->class_id, r->confidence,
		   r->peak_level, r->blast_count);
	ipc_post(&det);
}

/**
 * core1_main - core 1 entry: load the model, start the mic, listen forever
 *
 * registers as a multicore lockout victim first, so core 0 can pause core 1
 * when something (BTstack's flash bank) writes to flash. never returns: if
 * the model won't load, core 1 idles and core 0 carries on as a relay.
 */
static void core1_main(void) {
	static int32_t samples[LISTEN_CHUNK];
	classifier_result_t result;

	multicore_lockout_victim_init();

	if (!classifier_init(LISTEN_CALIB_DB_X10)) {
		printf("[listen] classifier_init failed, core 1 idle; node still relays\n");
		for (;;)
			__wfe();
	}

	mic_init(LISTEN_PIN_SD, LISTEN_PIN_SCK);
	skip_startup(samples);
	printf("[listen] mic + classifier running on core 1\n");

	for (;;) {
		size_t n = mic_read(samples, LISTEN_CHUNK);

		if (n == 0) {
			sleep_us(LISTEN_IDLE_US);
			continue;
		}

		classifier_push(samples, n);
		if (LISTEN_DEBUG)
			debug_level(samples, n);
		if (classifier_poll(&result))
			post_detection(&result);
	}
}

/**
 * listen_start - launch the mic + classifier loop on core 1
 */
void listen_start(void) {
	multicore_launch_core1_with_stack(core1_main, core1_stack, sizeof(core1_stack));
}
