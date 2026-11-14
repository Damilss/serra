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

static uint32_t core1_stack[LISTEN_STACK_WORDS];

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
