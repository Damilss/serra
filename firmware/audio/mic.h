// INMP441 I2S microphone capture: PIO generates the clocks and shifts samples in, DMA
// streams them into a ring buffer with no CPU involved, and mic_read() hands them out.
//
// Wiring (docs/classifier-interface.md): SD -> pin_sd, SCK -> pin_sck, WS -> pin_sck + 1,
// L/R -> GND, VDD -> 3V3(OUT), GND -> GND.

#ifndef SERRA_MIC_H
#define SERRA_MIC_H

#include <stddef.h>
#include <stdint.h>

#include "pico/types.h"

#ifdef __cplusplus
extern "C" {
#endif

#define MIC_SAMPLE_RATE 16000

// Samples the ring buffer holds (256 ms). Call mic_read() more often than this or the
// oldest audio is overwritten.
#define MIC_BUFFER_SAMPLES 4096

// The mic outputs zeros for its first 2^18 SCK cycles after the clock starts (~256 ms at
// 16 kHz). Throw away this many samples after mic_init().
#define MIC_STARTUP_SAMPLES 4800

// Starts the clocks and the capture. Claims one PIO state machine and one DMA channel.
// WS is on pin_sck + 1.
void mic_init(uint pin_sd, uint pin_sck);

// Copies up to `max` new samples to `out`, oldest first, and returns how many. Never
// blocks. Samples are signed 24-bit (full scale = +/- 2^23), as classifier_push() and
// features_pcm24_to_16() take them.
size_t mic_read(int32_t *out, size_t max);

#ifdef __cplusplus
}
#endif

#endif // SERRA_MIC_H
