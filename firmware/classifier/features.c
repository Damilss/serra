/**
 * author: Tobias Halpern <62962933+TobiasH453@users.noreply.github.com>
 * date: 2026-11-14
 * file: features.c
 *
 * audio features for the classifier: TFLM's audio microfrontend with the
 * micro_speech settings. see features.h.
 */
#include "features.h"

#include "tensorflow/lite/experimental/microfrontend/lib/frontend.h"
#include "tensorflow/lite/experimental/microfrontend/lib/frontend_util.h"

/**
 * DC_SHIFT - DC blocker pole; corner at fs / (2 * pi * 2^DC_SHIFT)
 *
 * about 20 Hz at 16 kHz.
 */
#define DC_SHIFT 7

static struct FrontendState frontend;
static bool frontend_ready;
static int32_t dc_prev_in;
static int32_t dc_prev_out;

/**
 * features_init - allocate the feature tables (heap, a few KB)
 *
 * safe to call again: frees the previous tables first.
 *
 * return: false = out of memory.
 */
bool features_init(void) {
	struct FrontendConfig config;

	/*
	 * the micro_speech settings. the filterbank spans 125 Hz to 7.5 kHz, which
	 * covers speech and the 2-4 kHz band where whistles sit.
	 */
	config.window.size_ms = FEATURES_WINDOW_MS;
	config.window.step_size_ms = FEATURES_STEP_MS;
	config.filterbank.num_channels = FEATURES_CHANNELS;
	config.filterbank.lower_band_limit = 125.0f;
	config.filterbank.upper_band_limit = 7500.0f;
	config.noise_reduction.smoothing_bits = 10;
	config.noise_reduction.even_smoothing = 0.025f;
	config.noise_reduction.odd_smoothing = 0.06f;
	config.noise_reduction.min_signal_remaining = 0.05f;
	config.pcan_gain_control.enable_pcan = 1;
	config.pcan_gain_control.strength = 0.95f;
	config.pcan_gain_control.offset = 80.0f;
	config.pcan_gain_control.gain_bits = 21;
	config.log_scale.enable_log = 1;
	config.log_scale.scale_shift = 6;

	if (frontend_ready) {
		FrontendFreeStateContents(&frontend);
	}
	frontend_ready = FrontendPopulateState(&config, &frontend, FEATURES_SAMPLE_RATE) != 0;
	dc_prev_in = 0;
	dc_prev_out = 0;
	return frontend_ready;
}

/**
 * features_reset - forget all audio history
 */
void features_reset(void) {
	if (frontend_ready) {
		FrontendReset(&frontend);
	}
	dc_prev_in = 0;
	dc_prev_out = 0;
}

/**
 * features_pcm24_to_16 - convert signed 24-bit mic samples to 16-bit
 *
 * return: the largest absolute sample seen, on the 24-bit scale and before
 * saturation.
 */
uint32_t features_pcm24_to_16(const int32_t *in, int16_t *out, size_t n) {
	uint32_t peak = 0;

	for (size_t i = 0; i < n; i++) {
		/* one-pole high-pass: y[n] = x[n] - x[n-1] + (1 - 2^-DC_SHIFT) * y[n-1] */
		int32_t x = in[i];
		int32_t y = x - dc_prev_in + dc_prev_out - (dc_prev_out >> DC_SHIFT);
		dc_prev_in = x;
		dc_prev_out = y;

		uint32_t mag = (uint32_t)(y < 0 ? -y : y);
		if (mag > peak) {
			peak = mag;
		}

		int32_t s = y >> FEATURES_PCM24_SHIFT;
		if (s > INT16_MAX) {
			s = INT16_MAX;
		} else if (s < INT16_MIN) {
			s = INT16_MIN;
		}
		out[i] = (int16_t)s;
	}
	return peak;
}

/**
 * features_process - feed samples to the feature extractor
 *
 * if features_init() failed, consumes all @n samples and returns false.
 *
 * return: true when a frame was written to @frame.
 */
bool features_process(const int16_t *samples, size_t n, size_t *consumed, uint8_t *frame) {
	*consumed = 0;
	if (!frontend_ready) {
		*consumed = n;
		return false;
	}

	while (*consumed < n) {
		size_t used = 0;
		struct FrontendOutput out =
			FrontendProcessSamples(&frontend, samples + *consumed, n - *consumed, &used);
		*consumed += used;
		if (out.values == NULL) {
			continue;
		}
		/*
		 * same scaling as micro_speech: the frontend's range of roughly 0-670
		 * maps onto 0-255, with anything above clamped.
		 */
		for (size_t c = 0; c < out.size && c < FEATURES_CHANNELS; c++) {
			uint32_t v = ((uint32_t)out.values[c] * 256u + 333u) / 666u;
			frame[c] = v > 255u ? 255u : (uint8_t)v;
		}
		return true;
	}
	return false;
}
