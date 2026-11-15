/**
 * author: Tobias Halpern <62962933+TobiasH453@users.noreply.github.com>
 * date: 2026-11-14
 * file: mic.h
 *
 * INMP441 I2S microphone capture: PIO generates the clocks and shifts
 * samples in, DMA streams them into a ring buffer with no CPU involved, and
 * mic_read() hands them out.
 *
 * wiring (docs/classifier-interface.md): SD -> pin_sd, SCK -> pin_sck,
 * WS -> pin_sck + 1, L/R -> GND, VDD -> 3V3(OUT), GND -> GND.
 *
 * bitstream fallback: one of our INMP441s came back from rework ignoring WS
 * and sending its raw one-bit converter output on SD instead of I2S words.
 * the audio in that stream is good, so mic_init() checks for it and, if it
 * finds it, mic_read() filters the stream down to the same 16 kHz, 24-bit
 * samples in software. a healthy mic never takes that path.
 */
#ifndef AUDIO_MIC_H
#define AUDIO_MIC_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "pico/types.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * MIC_SAMPLE_RATE - capture rate in Hz
 */
#define MIC_SAMPLE_RATE 16000

/**
 * MIC_BUFFER_SAMPLES - samples the ring buffer is sure to hold (256 ms)
 *
 * call mic_read() more often than this or the oldest audio is overwritten.
 */
#define MIC_BUFFER_SAMPLES 4096

/**
 * MIC_STARTUP_SAMPLES - samples to throw away after mic_init()
 *
 * the mic outputs zeros for its first 2^18 SCK cycles after the clock
 * starts (~256 ms at 16 kHz).
 */
#define MIC_STARTUP_SAMPLES 4800

/**
 * mic_init - start the clocks and the capture
 * @pin_sd: GPIO wired to the mic's SD
 * @pin_sck: GPIO wired to the mic's SCK; WS is on @pin_sck + 1
 *
 * claims one PIO state machine and one DMA channel. takes about 0.4 s: it
 * waits out the mic's startup and then checks which kind of data the mic is
 * sending.
 */
void mic_init(uint pin_sd, uint pin_sck);

/**
 * mic_is_bitstream - which path mic_init() chose
 *
 * return: true if the mic sends a raw bitstream and mic_read() is filtering
 * it, false for normal I2S.
 */
bool mic_is_bitstream(void);

/**
 * mic_read - copy new samples out of the ring buffer, oldest first
 * @out: where the samples go
 * @max: most samples to copy
 *
 * never blocks. samples are signed 24-bit (full scale = +/- 2^23), as
 * classifier_push() and features_pcm24_to_16() take them.
 *
 * return: how many samples were copied to @out, at most @max.
 */
size_t mic_read(int32_t *out, size_t max);

#ifdef __cplusplus
}
#endif

#endif /* AUDIO_MIC_H */
