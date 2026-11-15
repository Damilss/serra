/**
 * author: Tobias Halpern <62962933+TobiasH453@users.noreply.github.com>
 * date: 2026-11-14
 * file: mic.c
 *
 * INMP441 I2S microphone capture, with a fallback for a mic that sends a raw
 * bitstream. see mic.h.
 */
#include "mic.h"

#include <string.h>

#include "hardware/clocks.h"
#include "hardware/dma.h"
#include "hardware/pio.h"
#include "pico/time.h"

#include "i2s_mic.pio.h"
#include "pdm_filter.h"

/**
 * RING_BITS - log2 of the ring buffer's size in bytes
 * RING_BYTES - the ring buffer's size in bytes
 * RING_WORDS - the ring buffer's size in 32-bit words
 *
 * the DMA write address wraps on a power-of-two byte boundary, so the buffer
 * must be that size and aligned to it. I2S mode stores one word per sample;
 * bitstream mode needs two, so the ring is twice MIC_BUFFER_SAMPLES words.
 */
#define RING_BITS 15
#define RING_BYTES (1u << RING_BITS)
#define RING_WORDS (RING_BYTES / sizeof(uint32_t))
_Static_assert(RING_WORDS == 2 * MIC_BUFFER_SAMPLES, "ring size mismatch");

static uint32_t ring[RING_WORDS] __attribute__((aligned(RING_BYTES)));
static uint dma_chan;
static uint32_t read_pos; /* index of the next ring word mic_read() consumes */
static bool bitstream;

/*
 * bitstream mode: 1.024 MHz one-bit stream -> 64 kHz -> 16 kHz.
 *
 * stage 1 is a 96-tap FIR over single bits, run a byte at a time:
 * stage1_table[k][b] is the sum of the eight taps that byte k of the history
 * covers, for byte value b. one output per 16 bits. stage 2 is an ordinary
 * 96-tap FIR, one output per 4 inputs. then a DC blocker, because the stream
 * carries a constant offset that the mic's own I2S output would have removed.
 */
#define STAGE1_BYTES (PDM_STAGE1_TAPS / 8)
#define STAGE1_STEP_BYTES 2 /* 16 bits in per stage-1 output */
#define STAGE2_STEP 4

static int32_t stage1_table[STAGE1_BYTES][256];
static uint8_t stage1_hist[STAGE1_BYTES]; /* oldest byte first */
static uint8_t stage1_fill;				  /* bytes received since the last stage-1 output */
static int32_t stage2_hist[2 * PDM_STAGE2_TAPS]; /* each sample stored twice: no wrap in the loop */
static uint32_t stage2_pos;
static uint8_t stage2_fill;
static int32_t dc_prev_in;
static int64_t dc_prev_out; /* output << 8 */

/**
 * bitstream_setup - build the stage-1 table and clear the filter state
 */
static void bitstream_setup(void) {
	for (int k = 0; k < STAGE1_BYTES; k++) {
		for (int b = 0; b < 256; b++) {
			int32_t sum = 0;
			/* the first bit to arrive is the byte's top bit (the PIO shifts left) */
			for (int bit = 0; bit < 8; bit++) {
				int32_t tap = pdm_stage1[k * 8 + bit];
				sum += (b & (0x80 >> bit)) ? tap : -tap;
			}
			stage1_table[k][b] = sum;
		}
	}
	memset(stage1_hist, 0x55, sizeof(stage1_hist)); /* half ones: a silent stream */
	memset(stage2_hist, 0, sizeof(stage2_hist));
	stage1_fill = stage2_fill = 0;
	stage2_pos = 0;
	dc_prev_in = 0;
	dc_prev_out = 0;
}

/**
 * bitstream_push_byte - feed one byte of bitstream to the filters
 * @byte: eight bits of stream, first bit on top
 * @out: where a finished 16 kHz sample goes
 *
 * return: true when a sample was written to @out (once every 8 bytes).
 */
static inline bool bitstream_push_byte(uint8_t byte, int32_t *out) {
	memmove(stage1_hist, stage1_hist + 1, STAGE1_BYTES - 1);
	stage1_hist[STAGE1_BYTES - 1] = byte;
	if (++stage1_fill < STAGE1_STEP_BYTES) {
		return false;
	}
	stage1_fill = 0;

	int32_t mid = 0;
	for (int k = 0; k < STAGE1_BYTES; k++) {
		mid += stage1_table[k][stage1_hist[k]];
	}
	stage2_hist[stage2_pos] = mid;
	stage2_hist[stage2_pos + PDM_STAGE2_TAPS] = mid;
	stage2_pos = (stage2_pos + 1) % PDM_STAGE2_TAPS;
	if (++stage2_fill < STAGE2_STEP) {
		return false;
	}
	stage2_fill = 0;

	const int32_t *x = &stage2_hist[stage2_pos]; /* oldest of the last PDM_STAGE2_TAPS */
	int64_t acc = 0;
	for (int i = 0; i < PDM_STAGE2_TAPS; i++) {
		acc += (int64_t)x[i] * pdm_stage2[i];
	}
	int32_t sample = (int32_t)(acc >> PDM_STAGE2_SHIFT);

	/* one-pole DC blocker, corner about 5 Hz. state kept with 8 extra bits */
	int64_t y = dc_prev_out - (dc_prev_out >> 9) + (((int64_t)sample - dc_prev_in) << 8);
	dc_prev_in = sample;
	dc_prev_out = y;
	int32_t result = (int32_t)(y >> 8);
	if (result > 0x7FFFFF) {
		result = 0x7FFFFF;
	} else if (result < -0x800000) {
		result = -0x800000;
	}
	*out = result;
	return true;
}

/**
 * write_index - where DMA will write next, one past the newest word
 */
static uint32_t write_index(void) {
	return (dma_channel_hw_addr(dma_chan)->write_addr - (uintptr_t)ring) / sizeof(uint32_t);
}

/**
 * longest_run - longest run of equal bits in a word's top 24 bits
 */
static int longest_run(uint32_t word) {
	int best = 1, run = 1;
	for (int i = 30; i >= 8; i--) {
		if (((word >> i) & 1) == ((word >> (i + 1)) & 1)) {
			if (++run > best) {
				best = run;
			}
		} else {
			run = 1;
		}
	}
	return best;
}

/**
 * looks_like_bitstream - decide what the newest 256 words in the ring are
 *
 * a one-bit converter's output never holds one value for long: the mic we
 * measured never went past 3 equal bits in a row. I2S audio words start with
 * a run of sign bits and, even when loud, have longer runs somewhere almost
 * every time (at most 49% of words without one, over all our recordings).
 *
 * return: true if more than 90% of the words have no run longer than 4.
 */
static bool looks_like_bitstream(void) {
	uint32_t newest = write_index();
	int choppy = 0;
	const int n = 256;
	for (int i = 1; i <= n; i++) {
		if (longest_run(ring[(newest - i) % RING_WORDS]) <= 4) {
			choppy++;
		}
	}
	return choppy > n * 9 / 10;
}

/**
 * start - configure the state machine and DMA, and start capturing
 * @c: the PIO program's default config (wrap and side-set)
 * @offset: where the program was loaded
 */
static void start(PIO pio, uint sm, pio_sm_config c, uint offset, uint pin_sd, uint pin_sck) {
	sm_config_set_in_pins(&c, pin_sd);
	sm_config_set_sideset_pins(&c, pin_sck);
	sm_config_set_in_shift(&c, false, true, 32); /* shift left (MSB first), autopush at 32 */
	sm_config_set_fifo_join(&c, PIO_FIFO_JOIN_RX);
	/* two instructions per SCK cycle, 64 SCK cycles per sample */
	sm_config_set_clkdiv(&c, (float)clock_get_hz(clk_sys) / (MIC_SAMPLE_RATE * 64 * 2));
	pio_sm_init(pio, sm, offset, &c);

	/*
	 * DMA: PIO RX FIFO -> ring, forever. the write address wraps inside the
	 * ring and the transfer count never runs out, so no interrupt is needed to
	 * keep it going.
	 */
	dma_channel_config d = dma_channel_get_default_config(dma_chan);
	channel_config_set_transfer_data_size(&d, DMA_SIZE_32);
	channel_config_set_read_increment(&d, false);
	channel_config_set_write_increment(&d, true);
	channel_config_set_ring(&d, true, RING_BITS);
	channel_config_set_dreq(&d, pio_get_dreq(pio, sm, false));
	dma_channel_configure(dma_chan, &d, ring, &pio->rxf[sm], dma_encode_endless_transfer_count(),
						  true);

	read_pos = 0;
	pio_sm_set_enabled(pio, sm, true);
}

/**
 * mic_init - start the clocks and the capture
 *
 * starts in I2S mode, waits out the mic's startup, and switches to bitstream
 * mode if that is what the mic turns out to be sending.
 */
void mic_init(uint pin_sd, uint pin_sck) {
	PIO pio;
	uint sm;
	uint offset;

	/* picks whichever PIO block has a free state machine and room for the program */
	uint first = pin_sd < pin_sck ? pin_sd : pin_sck;
	uint last = pin_sd > pin_sck + 1 ? pin_sd : pin_sck + 1;
	bool ok = pio_claim_free_sm_and_add_program_for_gpio_range(&i2s_mic_program, &pio, &sm, &offset,
															   first, last - first + 1, true);
	hard_assert(ok);

	pio_gpio_init(pio, pin_sck);
	pio_gpio_init(pio, pin_sck + 1);
	pio_gpio_init(pio, pin_sd);
	/* the mic releases SD after its 24 bits; the pull-down makes the rest read as 0 */
	gpio_pull_down(pin_sd);
	pio_sm_set_consecutive_pindirs(pio, sm, pin_sck, 2, true);
	pio_sm_set_consecutive_pindirs(pio, sm, pin_sd, 1, false);

	dma_chan = dma_claim_unused_channel(true);
	bitstream = false;
	start(pio, sm, i2s_mic_program_get_default_config(offset), offset, pin_sd, pin_sck);

	/* a healthy mic sends zeros for its first ~256 ms; look at what follows that */
	sleep_ms(400);
	if (!looks_like_bitstream()) {
		return;
	}

	/* same pins and clock, but read every bit */
	pio_sm_set_enabled(pio, sm, false);
	dma_channel_abort(dma_chan);
	pio_remove_program(pio, &i2s_mic_program, offset);
	int at = pio_add_program(pio, &bitstream_mic_program);
	hard_assert(at >= 0);
	pio_sm_clear_fifos(pio, sm);
	pio_sm_restart(pio, sm);
	bitstream_setup();
	bitstream = true;
	start(pio, sm, bitstream_mic_program_get_default_config((uint)at), (uint)at, pin_sd, pin_sck);
}

/**
 * mic_is_bitstream - which path mic_init() chose
 */
bool mic_is_bitstream(void) {
	return bitstream;
}

/**
 * mic_read - copy new samples out of the ring buffer, oldest first
 *
 * reads the DMA channel's write address to find the newest word. in I2S mode
 * each 32-bit word (sample << 8) is shifted down to signed 24-bit; in
 * bitstream mode each word is 32 bits of stream, first bit on top, and two
 * words filter down to one sample.
 *
 * return: how many samples were copied to @out, at most @max.
 */
size_t mic_read(int32_t *out, size_t max) {
	uint32_t write_pos = write_index();
	size_t n = 0;

	if (!bitstream) {
		while (read_pos != write_pos && n < max) {
			/* arithmetic shift: drops the 8 empty bits and keeps the sign */
			out[n++] = (int32_t)ring[read_pos] >> 8;
			read_pos = (read_pos + 1) % RING_WORDS;
		}
		return n;
	}

	while (read_pos != write_pos && n < max) {
		uint32_t word = ring[read_pos];
		read_pos = (read_pos + 1) % RING_WORDS;
		for (int shift = 24; shift >= 0; shift -= 8) {
			if (bitstream_push_byte((uint8_t)(word >> shift), &out[n])) {
				n++;
			}
		}
	}
	return n;
}
