/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: main.c
 */
#include <stdio.h>

#include "blink_light/blink_light.h"
#include "mesh/mesh.h"
#include "pico/async_context.h"
#include "pico/cyw43_arch.h"
#include "pico/stdlib.h"

/**
 * BLINK_PERIOD_MS - LED toggle interval; 1000 ms = one blink every 2 s
 */
#define BLINK_PERIOD_MS 1000

/**
 * TEST_BEACON_PERIOD_MS - how often the test beacon sends a fake alert
 */
#define TEST_BEACON_PERIOD_MS 1000

/**
 * test_beacon_send - send a fake whistle alert, then schedule the next one
 * @context: the cyw43 async_context the worker runs on
 * @worker: this worker; re-added to repeat
 *
 * TEMPORARY: stands in for the classifier so node-to-node BLE can be tested
 * before audio exists. remove once real alerts come from core 1.
 */
static void test_beacon_send(async_context_t *context, async_at_time_worker_t *worker) {
	alert_payload_t alert = {
		.class_id = CLASS_WHISTLE,
		.confidence = 200,
		.peak_level = 853,
		.timestamp = to_ms_since_boot(get_absolute_time()),
		.blast_count = 3,
	};

	mesh_send_alert(&alert);
	printf("[main] queued node=0x%04x ts=%lu\n", mesh_node_id(), (unsigned long)alert.timestamp);
	async_context_add_at_time_worker_in_ms(context, worker, TEST_BEACON_PERIOD_MS);
}

static async_at_time_worker_t test_beacon_worker = {
	.do_work = test_beacon_send,
};

/**
 * main - bring up stdio and the radio chip, add workers, run the main loop
 *
 * all core 0 work (BTstack, the cyw43 driver, our timed workers) runs on
 * the cyw43 async_context in poll mode (pico_cyw43_arch_poll): it only runs
 * when this loop calls cyw43_arch_poll(). cyw43_arch_wait_for_work_until()
 * then sleeps until the next worker is due or the radio's interrupt says
 * there is work; at_the_end_of_time means "no deadline of our own".
 *
 * return: only on a startup failure; the main loop never returns.
 */
int main(void) {
	stdio_init_all();

	if (cyw43_arch_init()) {
		printf("[main] cyw43_arch_init failed\n");
		return 1;
	}

	if (mesh_init()) {
		printf("[main] mesh_init failed\n");
		return 1;
	}

	if (blink_light_init(BLINK_PERIOD_MS)) {
		printf("[main] blink_light_init failed\n");
		return 1;
	}

	if (!async_context_add_at_time_worker_in_ms(cyw43_arch_async_context(), &test_beacon_worker,
												TEST_BEACON_PERIOD_MS)) {
		printf("[main] test beacon failed to start\n");
		return 1;
	}

	printf("[main] main loop running\n");
	for (;;) {
		cyw43_arch_poll();
		cyw43_arch_wait_for_work_until(at_the_end_of_time);
	}
}
