/**
 * author: Tobias Halpern <62962933+TobiasH453@users.noreply.github.com>
 * date: 2026-11-14
 * file: features.h
 *
 * audio features for the classifier: 16 kHz PCM in, 40-channel filterbank
 * frames out.
 *
 * this wraps TFLM's audio microfrontend with the micro_speech settings. the
 * same file is compiled for the Pico and, as a shared library, for the
 * training pipeline (model/features.py), so the board sees exactly the
 * features the model was trained on. change anything here and the model
 * must be retrained.
 */
#ifndef CLASSIFIER_FEATURES_H
#define CLASSIFIER_FEATURES_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * FEATURES_SAMPLE_RATE - input sample rate in Hz
 * FEATURES_WINDOW_MS - length of the window each frame is computed over
 * FEATURES_STEP_MS - time between frames
 * FEATURES_CHANNELS - filterbank channels per frame
 * FEATURES_FRAMES - frames in one 1-second model input
 */
#define FEATURES_SAMPLE_RATE 16000
#define FEATURES_WINDOW_MS 30
#define FEATURES_STEP_MS 20
#define FEATURES_CHANNELS 40
#define FEATURES_FRAMES 49

/**
 * FEATURES_PCM24_SHIFT - low bits dropped converting 24-bit mic samples to 16-bit
 *
 * mic samples are signed 24-bit. the feature extractor takes 16-bit, so we
 * drop this many low bits instead of 8: a fixed +12 dB of gain. the INMP441
 * clips at 120 dB SPL, far louder than anything a node hears at a distance,
 * so plain >> 8 would leave quiet calls only a few counts above zero. with
 * >> 6 the 16-bit range tops out near 108 dB SPL.
 */
#define FEATURES_PCM24_SHIFT 6

/**
 * features_init - allocate the feature tables (heap, a few KB)
 *
 * call once.
 *
 * return: false = out of memory.
 */
bool features_init(void);

/**
 * features_reset - forget all audio history
 *
 * clears the noise estimate, gain control and partial window.
 */
void features_reset(void);

/**
 * features_pcm24_to_16 - convert signed 24-bit mic samples to 16-bit
 * @in: signed 24-bit mic samples
 * @out: the 16-bit samples the feature extractor takes; may not overlap @in
 * @n: samples in @in and @out
 *
 * removes the mic's DC offset, applies the fixed gain and saturates.
 *
 * return: the largest absolute sample seen, on the 24-bit scale and before
 * saturation (full scale = 1 << 23), for loudness measurement.
 */
uint32_t features_pcm24_to_16(const int32_t *in, int16_t *out, size_t n);

/**
 * features_process - feed samples to the feature extractor
 * @samples: 16-bit samples, e.g. from features_pcm24_to_16()
 * @n: samples in @samples
 * @consumed: set to the number of samples used
 * @frame: where a finished frame goes (FEATURES_CHANNELS bytes, 0-255)
 *
 * feeds samples until it completes one frame or runs out of input. after a
 * frame, call again with the remaining samples.
 *
 * return: true when a frame was written to @frame.
 */
bool features_process(const int16_t *samples, size_t n, size_t *consumed, uint8_t *frame);

#ifdef __cplusplus
}
#endif

#endif /* CLASSIFIER_FEATURES_H */
