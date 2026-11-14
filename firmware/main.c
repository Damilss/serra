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

	if (blink_light_init(BLINK_PERIOD_MS)) {
		printf("[main] blink_light_init failed\n");
		return 1;
	}

	printf("[main] scheduler running\n");
	sched_run();
}
