// mic_capture: streams the INMP441 to the PC over USB serial, for recording training data
// through the real mic. The other end is model/record.py.
//
// Stream format, repeated for as long as a program has the port open:
//     4 bytes   "SRA1"
//     4 bytes   index of the packet's first sample since boot (uint32, little-endian)
//     768 bytes 256 samples, signed 24-bit little-endian
// The index lets the PC notice dropped audio.

#include <stdint.h>
#include <string.h>

#include "pico/stdio_usb.h"
#include "pico/stdlib.h"

#include "mic.h"

// docs/classifier-interface.md: SD -> GP2, SCK -> GP3, WS -> GP4.
#define PIN_SD 2
#define PIN_SCK 3

#define PACKET_SAMPLES 256

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

		// Keep counting while nobody listens, so the index always means "since boot".
		if (stdio_usb_connected()) {
			memcpy(packet + 4, &index, 4);
			for (int i = 0; i < PACKET_SAMPLES; i++) {
				packet[8 + 3 * i] = (uint8_t)samples[i];
				packet[9 + 3 * i] = (uint8_t)(samples[i] >> 8);
				packet[10 + 3 * i] = (uint8_t)(samples[i] >> 16);
			}
			// Raw bytes: no newline, no CR/LF translation.
			stdio_put_string((const char *)packet, sizeof(packet), false, false);
			stdio_flush();
		}
		index += PACKET_SAMPLES;
	}
}
