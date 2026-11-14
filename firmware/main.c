/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: main.c
 */
#include <stdio.h>

#include "blink_light/blink_light.h"
#include "mesh/console.h"
#include "mesh/mesh.h"
#include "pico/cyw43_arch.h"
#include "pico/stdlib.h"
#include "runtime/ipc.h"

/**
 * BLINK_PERIOD_MS - LED toggle interval; 1000 ms = one blink every 2 s
 */
#define BLINK_PERIOD_MS 1000

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

	if (ipc_init()) {
		printf("[main] ipc_init failed\n");
		return 1;
	}

	if (blink_light_init(BLINK_PERIOD_MS)) {
		printf("[main] blink_light_init failed\n");
		return 1;
	}

	/* TEMPORARY: serial test commands + fake alerts until audio exists */
	if (console_init()) {
		printf("[main] console_init failed\n");
		return 1;
	}

	printf("[main] main loop running\n");
	for (;;) {
		cyw43_arch_poll();
		cyw43_arch_wait_for_work_until(at_the_end_of_time);
	}
}
