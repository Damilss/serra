// Audio features for the classifier: 16 kHz PCM in, 40-channel filterbank frames out.
//
// This wraps TFLM's audio microfrontend with the micro_speech settings. The same file is
// compiled for the Pico and, as a shared library, for the training pipeline
// (model/features.py), so the board sees exactly the features the model was trained on.
// Change anything here and the model must be retrained.

#ifndef SERRA_FEATURES_H
#define SERRA_FEATURES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define FEATURES_SAMPLE_RATE 16000
#define FEATURES_WINDOW_MS 30
#define FEATURES_STEP_MS 20
#define FEATURES_CHANNELS 40 // filterbank channels per frame
#define FEATURES_FRAMES 49	 // frames in one 1-second model input

// Mic samples are signed 24-bit. The feature extractor takes 16-bit, so we drop this many low bits
// instead of 8: a fixed +12 dB of gain. The INMP441 clips at 120 dB SPL, far louder than
// anything a node hears at a distance, so plain >> 8 would leave quiet calls only a few
// counts above zero. With >> 6 the 16-bit range tops out near 108 dB SPL.
#define FEATURES_PCM24_SHIFT 6

// Allocates the feature tables (heap, a few KB). Call once; false = out of memory.
bool features_init(void);

// Forgets all audio history (noise estimate, gain control, partial window).
void features_reset(void);

// Converts signed 24-bit mic samples to the 16-bit samples the feature extractor takes: removes the
// mic's DC offset, applies the fixed gain and saturates. `in` and `out` may not overlap.
// Returns the largest absolute sample seen, on the 24-bit scale and before saturation
// (full scale = 1 << 23), for loudness measurement.
uint32_t features_pcm24_to_16(const int32_t *in, int16_t *out, size_t n);

// Feeds samples to the feature extractor until it completes one frame or runs out of input.
// Sets *consumed to the number of samples used. Returns true when a frame was written to
// `frame` (FEATURES_CHANNELS bytes, 0-255); call again with the remaining samples.
bool features_process(const int16_t *samples, size_t n, size_t *consumed, uint8_t *frame);

#ifdef __cplusplus
}
#endif

#endif // SERRA_FEATURES_H
