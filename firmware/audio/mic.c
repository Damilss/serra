// See mic.h.

#include "mic.h"

#include "hardware/clocks.h"
#include "hardware/dma.h"
#include "hardware/pio.h"

#include "i2s_mic.pio.h"

// The DMA write address wraps on a power-of-two byte boundary, so the buffer must be that
// size and aligned to it.
#define RING_BITS 14
#define RING_BYTES (1u << RING_BITS)
_Static_assert(RING_BYTES == MIC_BUFFER_SAMPLES * sizeof(uint32_t), "ring size mismatch");

static uint32_t ring[MIC_BUFFER_SAMPLES] __attribute__((aligned(RING_BYTES)));
static uint dma_chan;
static uint32_t read_pos; // index of the next sample mic_read() returns

void mic_init(uint pin_sd, uint pin_sck) {
	PIO pio;
	uint sm;
	uint offset;

	// Picks whichever PIO block has a free state machine and room for the program.
	uint first = pin_sd < pin_sck ? pin_sd : pin_sck;
	uint last = pin_sd > pin_sck + 1 ? pin_sd : pin_sck + 1;
	bool ok = pio_claim_free_sm_and_add_program_for_gpio_range(&i2s_mic_program, &pio, &sm, &offset,
															   first, last - first + 1, true);
	hard_assert(ok);

	pio_sm_config c = i2s_mic_program_get_default_config(offset);
	sm_config_set_in_pins(&c, pin_sd);
	sm_config_set_sideset_pins(&c, pin_sck);
	sm_config_set_in_shift(&c, false, true, 32); // shift left (MSB first), autopush at 32
	sm_config_set_fifo_join(&c, PIO_FIFO_JOIN_RX);
	// Two instructions per SCK cycle, 64 SCK cycles per sample.
	sm_config_set_clkdiv(&c, (float)clock_get_hz(clk_sys) / (MIC_SAMPLE_RATE * 64 * 2));

	pio_gpio_init(pio, pin_sck);
	pio_gpio_init(pio, pin_sck + 1);
	pio_gpio_init(pio, pin_sd);
	// The mic releases SD after its 24 bits; the pull-down makes the rest read as 0.
	gpio_pull_down(pin_sd);
	pio_sm_set_consecutive_pindirs(pio, sm, pin_sck, 2, true);
	pio_sm_set_consecutive_pindirs(pio, sm, pin_sd, 1, false);
	pio_sm_init(pio, sm, offset, &c);

	// DMA: PIO RX FIFO -> ring, forever. The write address wraps inside the ring and the
	// transfer count never runs out, so no interrupt is needed to keep it going.
	dma_chan = dma_claim_unused_channel(true);
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

size_t mic_read(int32_t *out, size_t max) {
	// Where DMA will write next = one past the newest sample.
	uint32_t write_pos =
		(dma_channel_hw_addr(dma_chan)->write_addr - (uintptr_t)ring) / sizeof(uint32_t);
	size_t n = 0;

	while (read_pos != write_pos && n < max) {
		// Arithmetic shift: drops the 8 empty bits and keeps the sign.
		out[n++] = (int32_t)ring[read_pos] >> 8;
		read_pos = (read_pos + 1) % MIC_BUFFER_SAMPLES;
	}
	return n;
}
