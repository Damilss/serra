// Host-only helpers around firmware/classifier/features.c, built into a shared library by
// features.py. Whole-clip loops live here so Python makes one call per clip.

#include "features.h"

// Runs a whole clip through the feature extractor from a clean state. Writes up to max_frames
// frames of FEATURES_CHANNELS bytes to out and returns the number written.
size_t serra_clip_features(const int16_t *samples, size_t n, uint8_t *out, size_t max_frames) {
	size_t frames = 0;
	size_t pos = 0;

	features_reset();
	while (pos < n && frames < max_frames) {
		size_t used = 0;
		if (features_process(samples + pos, n - pos, &used, out + frames * FEATURES_CHANNELS)) {
			frames++;
		}
		pos += used;
	}
	return frames;
}

// Mic path: signed 24-bit samples (in int32) to the 16-bit samples the feature extractor takes,
// from a clean DC-blocker state. Returns the peak, as features_pcm24_to_16 does.
uint32_t serra_clip_pcm24_to_16(const int32_t *in, int16_t *out, size_t n) {
	features_reset();
	return features_pcm24_to_16(in, out, n);
}
