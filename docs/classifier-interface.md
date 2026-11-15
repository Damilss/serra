# Classifier interface: what firmware needs to know

Handoff from the model side to the firmware side. Covers the mic, the runtime the model needs, the C API firmware calls, and the memory/flash budget. Items marked **Proposal** are open until firmware agrees.

---

## 1. Microphone: INMP441

| | |
|---|---|
| Part | TDK InvenSense **INMP441**, omnidirectional MEMS mic on a 6-pin breakout. Ours: the round JESSINIE 3-pack module; pin labels on the back, headers ship loose. **Headers soldered; ready to wire up** |
| Clone check | Cheap modules sometimes carry a pin-compatible clone chip. If a module reads only zeros at SCK 1.024 MHz, run SCK at 2.048 MHz (32 kHz) and decimate to 16 kHz in software |
| Interface | **I2S** (not UART/SPI/I2C), 24-bit two's complement, MSB first, 64 SCK cycles per stereo frame (32 per slot) |
| Pins | `VDD`, `GND`, `SCK` (bit clock, Pico drives), `WS` (word select / LR clock, Pico drives), `SD` (data out from mic), `L/R` (channel select) |
| Channel | `L/R` tied to **GND** → mic talks in the **left** slot; right slot is high-impedance, ignore it |
| Our clocking | 16 kHz sample rate → `WS` = 16 kHz, `SCK` = 64 × 16 kHz = **1.024 MHz** (datasheet allows SCK 0.5–3.2 MHz, WS 7.8–50 kHz) |
| How the Pico reads it | RP2350 has no I2S peripheral → a **PIO** program generates SCK/WS and shifts in SD; **DMA** moves words to RAM. Each 32-bit word → sample with an arithmetic shift: `int32_t s = ((int32_t)w) >> 8;` |
| Supply voltage | 1.62–3.63 V. Power it from the Pico's **3V3(OUT)** pin |
| Current @ 3.3 V | **2.2 mA typ, 2.5 mA max** (normal); 0.8 mA standby (SCK stopped); 4.5 µA power-down. About 7 mW, small next to the RP2350 and radio |
| Startup | Zero output for the first 2^18 SCK cycles after power-up: **~256 ms at our 1.024 MHz** clock. Restart from standby (SCK stopped then restarted): 2^14 cycles, ~16 ms. Throw away samples during these windows |
| Power-down | Needs the chip's `CHIPEN` pin, which most breakouts tie high, so in practice: run, or stop SCK for standby |

**Proposal: pins.** `SD` → **GP2**, `SCK` → **GP3**, `WS` → **GP4** (SCK and WS adjacent so PIO can drive both as side-set pins). Avoids GP0/GP1 (UART0, used by the BLE scan example) and the pins the CYW43 radio uses internally. Plus `L/R` → GND, `VDD` → 3V3(OUT), `GND` → GND.

Source: INMP441 datasheet DS-INMP441-00 rev 1.1 (Electrical Characteristics, Timing, Power Management and I²S Data Interface sections).

**Bitstream fallback (2026-11-14).** One of our three mics came back from rework ignoring WS: it sends its raw one-bit converter output on SD at the SCK rate instead of I2S words, in both halves of the frame. A healthy mic could not be made to do this with any WS signal we tried, so we treat that chip as damaged. The audio in the stream is good, so `mic_init()` checks for it at boot (0.4 s) and, if found, `mic_read()` filters it to the same 16 kHz, 24-bit samples (1.024 MHz → 64 kHz → 16 kHz, flat to 7 kHz, then a DC blocker). Coefficients come from `model/pdm_filter.py`. Measured on that mic: room noise within 2-3 dB per band of a healthy mic, test tones at the right frequency with no folded images above -33 dB, classifier in real time. Its level is not calibrated against the healthy mics. `classifier_bench` and `board_test.py` report which path a mic is on.

---

## 2. Runtime the model needs

| | |
|---|---|
| Target | Pico 2 W, **Arm Cortex-M33** build (`PICO_BOARD=pico2_w`), Pico SDK 2.3.1. No RISC-V |
| Inference engine | **TensorFlow Lite Micro** with CMSIS-NN kernels, from a [`pico-tflmicro`](https://github.com/raspberrypi/pico-tflmicro) checkout (tested at commit `dfea53b`), int8 model. Not vendored: `scripts/install-firmware-tooling.sh` clones it at that commit. `firmware/classifier/classifier.cmake` finds it through `PICO_TFLMICRO_PATH` (default: a `pico-tflmicro` folder next to the Pico SDK, where the script puts it) and builds it |
| Language | Our module is C++ internally (TFLM is C++) with a **plain C header**, so `main.c` stays C. CMake already enables CXX |
| Feature extraction | TFLM's audio "microfrontend" (C). Same code computes features in training, so the board sees what the model was trained on |
| Threading | Call everything from **one core** (plan: core 1 = audio + classifier, core 0 = radio + mesh). Never blocks, never busy-waits. Fits your `pico_cyw43_arch_poll` loop on core 0: pass results across with a `queue_t` |
| Audio in | 16 kHz mono, left-slot samples already shifted to signed 24-bit (`(int32_t)w >> 8`), as `int32_t`. We do the rest |

---

## 3. C API (our engineering decision, not dictated by the model)

The model itself only outputs 5 scores (whistle, scream, help, other_speech, background). The wrapper turns those into ready-made alert fields, shaped to match `alert_payload_t` in the README so firmware can copy them straight into the packet.

```c
// firmware/classifier/classifier.h (implemented; see the header for the full comments)
typedef struct {
    uint8_t class_id;     // alert_class_t (mesh/packet.h): CLASS_WHISTLE = 1, CLASS_SCREAM = 2, CLASS_HELP = 3
    uint8_t confidence;   // 0–255
    int16_t peak_level;   // tenths of a dB: dBFS of the loudest moment + this node's calibration offset
    uint8_t blast_count;  // whistles only (3 = distress pattern), 0 otherwise
} classifier_result_t;

bool classifier_init(int16_t calib_offset_db_x10);         // once at boot; false = model failed to load
void classifier_push(const int32_t *samples24, size_t n);  // feed audio as it arrives (from DMA)
bool classifier_poll(classifier_result_t *out);            // call often; true = new detection in *out
```

- The wake trigger ([README decision 7](../README.md#7-listen-cheaply-classify-rarely)) lives inside this module: `classifier_poll` first checks the loudness of the newest audio (above ~160 Hz, so room rumble doesn't count) and returns `false` right away when it's quiet. Only when it's loud, and for a second afterwards, does it run inference, once per 240 ms of new audio. The wake level is -60 dBFS peak; it is a constant in `classifier.cc` and still needs tuning in the demo room.
- `classifier_poll` returns `true` once per detected event, not once per window. The event is reported when it ends (about 1.5 s after the sound stops) so the peak level and blast count cover all of it; a sound that keeps going is reported every ~3 s (whistles: ~8 s).
- No detections for the first 3 s after `classifier_init`, while the feature code learns the noise floor.
- To build it into the node: `include(classifier/classifier.cmake)` after `pico_sdk_init()` and link `serra_classifier`. `firmware/tools/classifier_bench` is a working example that feeds it from `mic_read()`.
- **Firmware fills in:** `timestamp`, the mesh header (`src`, `msg_id`, `ttl`, ...). The classifier knows nothing about the mesh.
- `other_speech` and `background` never come out of `classifier_poll`. Firmware only ever sees alerts.
- **Over-the-air format** is the 9-byte `alert_payload_t` in the README's Mesh protocol section. That's a team contract (changes need firmware, base station and README updated together).

---

## 4. Hardware budget: does it fit?

First trained model: **24,997 parameters, 47 KB** as an int8 `.tflite`, ~2.7 M multiply-adds per 1-second window. Measured on a Pico 2 W on 2026-11-14 with `firmware/tools/classifier_bench` (Release build, code running from flash).

| Resource (RP2350) | Total | Classifier uses (measured) | Notes |
|---|---|---|---|
| Flash | 4 MB | ~215 KB: 47 KB model + TFLM, CMSIS-NN and feature code (bench image minus the mic-only image; includes TFLM's error strings) | Radio firmware is ~230 KB, BLE image ~400 KB total (firmware README). Well under 1 MB all-in |
| SRAM | 520 KB | ~78 KB: 48 KB arena (42.9 KB used), 16 KB mic ring buffer, 11 KB feature tables on the heap, 2 KB feature window | Leaves 400+ KB for BTstack, CYW43 and the mesh |
| CPU | 2 × M33 @ 150 MHz | **70.6 ms** per inference; 0.75 ms of feature code per 20 ms frame | Features always run: ~4% of one core. Inference every 240 ms while sound is present: ~30% of one core |

**Headroom:** the model could grow ~10× before memory becomes a real constraint. In practice, model size is limited by inference time (power) and training data, not by RAM or flash.

---

## 5. Open items

- [ ] Agree on the pins (section 1) and who writes the PIO I2S driver. **Proposal:** the model side writes it, since we also need it to record training data through the real mic.
- [ ] Agree on the C API (section 3).
- [x] `pico-tflmicro` builds for `pico2_w` on SDK 2.3.1 with GCC 15 (two workarounds, both in `classifier.cmake`) and gives the same scores as TFLite on the PC.
- [x] `pico-tflmicro` is a documented dependency ([README design decision 12](../README.md#12-tensorflow-lite-micro-from-a-pinned-pico-tflmicro-checkout)) and `scripts/install-firmware-tooling.sh` clones it at the pinned commit.
- [x] Measure arena size and inference time on a Pico 2 W (section 4).
- [ ] Test the wake level, event grouping and blast counting against real whistles and shouts; so far they have only seen synthetic audio.
- [ ] Merge `docs/sdk-help-detection` into `main`. Until then, `main`'s README still has the old `alert_payload_t` (`WHISTLE, VOICE`, unsigned `peak_level`); this doc follows the new one.
