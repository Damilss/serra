/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: main.c
 */
#include <stdio.h>

#include "blink_light/blink_light.h"
#include "pico/cyw43_arch.h"
#include "pico/stdlib.h"
#include "runtime/scheduler.h"

/**
 * BLINK_PERIOD_MS - LED toggle interval; 500 ms = one blink per second
 */
#define BLINK_PERIOD_MS 500

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

	if (blink_light_init(BLINK_PERIOD_MS)) {
		printf("[main] blink_light_init failed\n");
		return 1;
	}

	printf("[main] scheduler running\n");
	sched_run();
}
