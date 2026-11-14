/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: blink_light.c
 *
 * this will run on core 0, The LED is on the CYW43 wifi chip
 */
#include "blink_light.h"

#include <stdbool.h>

#include "pico/async_context.h"
#include "pico/cyw43_arch.h"

static bool led_on;
static uint32_t blink_period_ms;

/**
 * blink_light_toggle - flip the LED, then schedule the next toggle
 * @context: the cyw43 async_context the worker runs on
 * @worker: this worker
 *
 * an at-time worker runs once and is removed, so it re-adds itself
 * @blink_period_ms from now to keep blinking.
 */
static void blink_light_toggle(async_context_t *context, async_at_time_worker_t *worker) {
	led_on = !led_on;
	cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, led_on);
	async_context_add_at_time_worker_in_ms(context, worker, blink_period_ms);
}

static async_at_time_worker_t blink_worker = {
	.do_work = blink_light_toggle,
};

/**
 * blink_light_init - start blinking the onboard LED
 * @period_ms: time between LED toggles
 *
 * return: 0 on success, -1 if the async_context rejected the worker.
 */
int blink_light_init(uint32_t period_ms) {
	blink_period_ms = period_ms;
	return async_context_add_at_time_worker_in_ms(cyw43_arch_async_context(), &blink_worker, 0)
			   ? 0
			   : -1;
}
