/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: blink_light.c
 */
#include "blink_light.h"

#include <stdbool.h>

#include "pico/cyw43_arch.h"
#include "runtime/scheduler.h"

static bool led_on;

/**
 * blink_light_toggle - flip the LED; the scheduler calls this every period
 * @ctx: unused
 */
static void blink_light_toggle(void *ctx) {
	(void)ctx;
	led_on = !led_on;
	cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, led_on);
}

static sched_task_func_t blink_task = {
	.name = "blink_light",
	.function = blink_light_toggle,
	.ctx = NULL,
};

/**
 * blink_light_init - start blinking the onboard LED as a scheduler task
 * @period_ms: time between LED toggles
 *
 * return: 0 on success, -1 if the scheduler rejected the task.
 */
int blink_light_init(uint32_t period_ms) {
	blink_task.period_ms = period_ms;
	return sched_add(&blink_task);
}
