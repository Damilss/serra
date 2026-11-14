/**
 * author: Tobias Halpern <62962933+TobiasH453@users.noreply.github.com>
 * date: 2026-11-14
 * file: main.c
 *
 * mic_capture: streams the INMP441 to the PC over USB serial, for recording training data
 * through the real mic. the other end is model/record.py. a standalone build with no radio
 * code; everything runs in the one main() loop on core 0.
 *
 * stream format, repeated for as long as a program has the port open:
 *     4 bytes   "SRA1"
 *     4 bytes   index of the packet's first sample since boot (uint32, little-endian)
 *     768 bytes 256 samples, signed 24-bit little-endian
 * the index lets the PC notice dropped audio. model/record.py and model/dev_ui.py parse
 * this stream, so its format is fixed.
 */
#include <stdint.h>
#include <string.h>

#include "pico/stdio_usb.h"
#include "pico/stdlib.h"

#include "mic.h"

/**
 * PIN_SD - GPIO for the INMP441's SD (data) line
 * PIN_SCK - GPIO for the INMP441's SCK (bit clock) line
 *
 * docs/classifier-interface.md: SD -> GP2, SCK -> GP3, WS -> GP4. WS isn't set here:
 * mic_init() puts it on PIN_SCK + 1.
 */
#define PIN_SD 2
#define PIN_SCK 3

/**
 * PACKET_SAMPLES - samples per packet; 256 at 3 bytes each is the 768-byte body
 */
#define PACKET_SAMPLES 256

/**
 * main - start the mic, then send every PACKET_SAMPLES samples as one packet
 *
 * packets are only sent while a program has the port open, but the sample index counts
 * all audio since boot.
 *
 * return: never; the loop runs forever.
 */
int main(void) {
	static int32_t samples[PACKET_SAMPLES];
	static uint8_t packet[8 + PACKET_SAMPLES * 3];
	uint32_t index = 0;
	size_t have = 0;

	stdio_init_all();
	mic_init(PIN_SD, PIN_SCK);
	memcpy(packet, "SRA1", 4);

	while (true) {
		have += mic_read(samples + have, PACKET_SAMPLES - have);
		if (have < PACKET_SAMPLES) {
			sleep_us(500);
			continue;
		}
		have = 0;

		/* keep counting while nobody listens, so the index always means "since boot" */
		if (stdio_usb_connected()) {
			memcpy(packet + 4, &index, 4);
			for (int i = 0; i < PACKET_SAMPLES; i++) {
				packet[8 + 3 * i] = (uint8_t)samples[i];
				packet[9 + 3 * i] = (uint8_t)(samples[i] >> 8);
				packet[10 + 3 * i] = (uint8_t)(samples[i] >> 16);
			}
			/* raw bytes: no newline, no CR/LF translation */
			stdio_put_string((const char *)packet, sizeof(packet), false, false);
			stdio_flush();
		}
		index += PACKET_SAMPLES;
	}
}
