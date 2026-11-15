/**
 * author: Tobias Halpern <62962933+TobiasH453@users.noreply.github.com>
 * date: 2026-11-14
 * file: features_host.c
 *
 * host-only helpers around firmware/classifier/features.c, built into a shared library by
 * features.py. whole-clip loops live here so Python makes one call per clip. never built
 * for the board.
 */
#include "features.h"

/**
 * serra_clip_features - run a whole clip through the feature extractor
 * @samples: the clip, 16-bit PCM
 * @n: samples in @samples
 * @out: room for @max_frames frames of FEATURES_CHANNELS bytes each
 * @max_frames: frames @out can hold; extraction stops there
 *
 * starts from a clean state (features_reset()), so earlier clips don't leak in.
 *
 * return: the number of frames written to @out.
 */
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

/**
 * serra_clip_pcm24_to_16 - mic path: convert a whole clip to feature-extractor samples
 * @in: signed 24-bit samples (in int32)
 * @out: the 16-bit samples the feature extractor takes; @n of them
 * @n: samples in @in
 *
 * starts from a clean DC-blocker state (features_reset()).
 *
 * return: the peak, as features_pcm24_to_16() returns it.
 */
uint32_t serra_clip_pcm24_to_16(const int32_t *in, int16_t *out, size_t n) {
	features_reset();
	return features_pcm24_to_16(in, out, n);
}
