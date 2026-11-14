/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: main.c
 */
#include <stdio.h>

#include "blink_light/blink_light.h"
#include "mesh/mesh.h"
#include "pico/cyw43_arch.h"
#include "pico/stdlib.h"
#include "runtime/scheduler.h"

/**
 * BLINK_PERIOD_MS - LED toggle interval; 500 ms = one blink per second
 */
#define BLINK_PERIOD_MS 500

/**
 * TEST_BEACON_PERIOD_MS - how often the test beacon sends a fake alert
 */
#define TEST_BEACON_PERIOD_MS 1000

/**
 * radio_idle - scheduler hooks that drive the CYW43 driver and BTstack
 *
 * poll mode (pico_cyw43_arch_poll): radio work only happens when the loop
 * calls cyw43_arch_poll(). cyw43_arch_wait_for_work_until() sleeps until the
 * next task is due or the radio's interrupt says there is work.
 */
static const sched_idle_t radio_idle = {
	.poll = cyw43_arch_poll,
	.wait_until = cyw43_arch_wait_for_work_until,
};

/**
 * test_beacon_send - send a fake whistle alert with a fresh msg_id
 * @ctx: unused
 *
 * TEMPORARY: stands in for the classifier so node-to-node BLE can be tested
 * before audio exists. remove once real alerts come from core 1.
 */
static void test_beacon_send(void *ctx) {
	(void)ctx;
	alert_payload_t alert = {
		.class_id = CLASS_WHISTLE,
		.confidence = 200,
		.peak_level = 853,
		.timestamp = to_ms_since_boot(get_absolute_time()),
		.blast_count = 3,
	};

	mesh_send_alert(&alert);
	printf("[main] tx node=0x%04x ts=%lu\n", mesh_node_id(), (unsigned long)alert.timestamp);
}

static sched_task_func_t test_beacon_task = {
	.name = "test_beacon",
	.function = test_beacon_send,
	.ctx = NULL,
	.period_ms = TEST_BEACON_PERIOD_MS,
};

/**
 * main - bring up stdio and the radio chip, register tasks, run the scheduler
 *
 * return: only on a startup failure; the scheduler itself never returns.
 */
int main(void) {
	stdio_init_all();

	if (cyw43_arch_init()) {
		printf("[main] cyw43_arch_init failed\n");
		return 1;
	}

	sched_set_idle(&radio_idle);

	if (mesh_init()) {
		printf("[main] mesh_init failed\n");
		return 1;
	}

	if (blink_light_init(BLINK_PERIOD_MS)) {
		printf("[main] blink_light_init failed\n");
		return 1;
	}

	if (sched_add(&test_beacon_task)) {
		printf("[main] test beacon failed to register\n");
		return 1;
	}

	printf("[main] scheduler running\n");
	sched_run();
}
