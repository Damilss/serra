/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: blink_light.h
 *
 * this will run on core 0, The LED is on the CYW43 wifi chip
 */
#ifndef BLINK_LIGHT_BLINK_LIGHT_H
#define BLINK_LIGHT_BLINK_LIGHT_H
#include <stdint.h>

/**
 * blink_light_init - start blinking the onboard LED as a scheduler task
 * @period_ms: time between LED toggles; one full on/off blink takes 2 * @period_ms
 *
 * the Pico 2 W's LED is wired to the CYW43 radio chip, not an RP2350 GPIO,
 * so call this after cyw43_arch_init(). a blinking LED then shows that the
 * scheduler is running and the radio chip started.
 *
 * return: 0 on success, -1 if the scheduler rejected the task.
 */
int blink_light_init(uint32_t period_ms);

#endif /* BLINK_LIGHT_BLINK_LIGHT_H */
