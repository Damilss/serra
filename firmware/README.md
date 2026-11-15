# firmware

Firmware for the Serra field nodes: Raspberry Pi Pico 2 W (RP2350, Arm Cortex-M33, CYW43439 radio). See the [project README](../README.md) for what the nodes do and why.

The firmware builds on the **Pico SDK 2.3.1** ([design decision 6](../README.md#6-keep-the-pico-sdks-radio-driver)). The SDK provides the startup code, hardware drivers, the CYW43 radio driver and the BTstack Bluetooth stack. Our code (runtime, audio, classifier, mesh) sits on top.

---

## Table of contents

1. [Status](#status)
2. [Layout](#layout)
3. [Prerequisites](#prerequisites)
4. [Smoke test](#smoke-test)
5. [Tools](#tools)
6. [Gotchas](#gotchas)
7. [Next steps](#next-steps)
8. [References](#references)

---

## Status

| Piece | State |
|---|---|
| Toolchain + Pico SDK 2.3.1 install (`scripts/install-firmware-tooling.sh`) | Done (macOS); builds on Linux (WSL2) too |
| SDK images on hardware (build info, timers, USB stdio) | Done |
| SDK smoke test: `picow_blink` (onboard LED through the CYW43) | Builds; **not yet run on a Pico 2 W** |
| SDK smoke test: `ble_temp_server` (BLE advertising) | Builds; **not yet run on a Pico 2 W** |
| INMP441 mic hardware | **Working on 3 × Pico 2 W (2026-11-14)**, wired per [`docs/classifier-interface.md`](../docs/classifier-interface.md#1-microphone-inmp441). One module ignores WS and sends its raw one-bit stream; `mic.c` detects that at boot and filters it to normal samples. Another had a loose connection. See the [mic report](../docs/reports/firmware/2026-11-14-mic-classifier-nodes.md) |
| BLE advertise test with our packet format | **Works on 2 × Pico 2 W (2026-11-14)**: each board advertises a test alert every second and the other decodes it over the air (`[mesh] rx src=...` on serial) |
| Our firmware (`node.uf2`): `main.c` + `blink_light` + `mesh/` | **Runs on a Pico 2 W**: LED toggles every 1000 ms. All core 0 work runs as `async_context` workers on the cyw43 context; `main.c` loops on `cyw43_arch_poll()` + `cyw43_arch_wait_for_work_until()`. Ported off our own scheduler 2026-11-14 and re-tested on hardware: LED, BLE and mesh tx/rx all work |
| BTstack (`pico_btstack_ble`, `pico_btstack_cyw43`) + `btstack_config.h` (BLE only) | Used by `mesh/ble.c`: non-connectable advertising + passive scan, filtered on company ID `0xFFFF` and `MESH_MAGIC` |
| `mesh/mesh.c` | Node ID from the board ID, random `msg_id` seed, `mesh_send_alert()`, drops duplicate `(src, msg_id)` pairs, shares the advertising slot through `mesh/tx_queue.c` (alerts expire after 5 s) and relays new packets with `ttl - 1` (PR #6). `mesh/console.c` is a serial test console (`h` for help); its fake-alert beacon starts paused (`p` toggles it) so real detections aren't mixed with fake ones |
| `classifier/` (`serra_classifier`: microfrontend features + int8 model on TensorFlow Lite Micro) + `tools/classifier_bench` | **Runs on a Pico 2 W**: 70.6 ms per inference, 42.9 KB of a 48 KB arena, ~215 KB flash ([measurements](../docs/classifier-interface.md)). Needs a `pico-tflmicro` checkout ([Prerequisites](#prerequisites)). **Not yet linked into `node.uf2`** |
| Mic + classifier on the node: `audio/listen.c` (core 1) + `runtime/ipc` (core 1 → core 0) | **Works on 3 × Pico 2 W (2026-11-14)**: each node detects whistle / scream / "help", hands the detection to core 0 and broadcasts it; the other nodes decode it. Mic driver, features, model and TFLM wrapper from PR #5. [Report](../docs/reports/firmware/2026-11-14-mic-classifier-nodes.md) |
| `runtime/node_state`, `audio/audio.c` | Empty placeholders |

---

## Layout

```
firmware/
├── CMakeLists.txt     # SDK build for PICO_BOARD=pico2_w
├── btstack_config.h   # BTstack options (BLE only); the pico_btstack_* libraries require it
├── main.c             # core 0: radio, mesh, workers, then starts core 1
├── runtime/           # ipc: core 1 -> core 0 detections; node state and power management planned
├── audio/             # mic.c + i2s_mic.pio (INMP441 over PIO/DMA; detects a mic that sends a raw bitstream); listen.c: core 1 mic + classifier loop
├── classifier/        # features + int8 model on TFLM (classifier.cmake); vendored C in third_party/
├── mesh/              # packet.h (wire format), ble.c (advertise/scan), mesh.c (send/receive)
├── tools/
│   ├── classifier_bench/  # classifier on the board: arena, timing, test scores, live mic (needs pico-tflmicro)
│   └── mic_capture/       # streams the mic over USB serial for model/record.py
└── build/             # generated, git-ignored
```

---

## Prerequisites

| Tool | Why |
|---|---|
| `arm-none-eabi-gcc` (Arm GNU Toolchain) | cross-compiler, linker, `objdump`, `nm`, `size` |
| `cmake`, `ninja` | the SDK's build system |
| Pico SDK **2.3.1**, with submodules | startup, drivers, `cyw43-driver`, `btstack`, `tinyusb`, `lwip`, `mbedtls` |
| `picotool` ≥ 2.0 | loads images over USB; 1.x doesn't support the RP2350. The SDK build also uses it to make `.uf2` files |
| host C/C++ compiler, `python3` | the SDK builds `pioasm` for your machine and generates BTstack GATT headers during the build (Xcode command line tools on macOS) |
| [`pico-tflmicro`](https://github.com/raspberrypi/pico-tflmicro) at commit **`dfea53b`** | TensorFlow Lite Micro with CMSIS-NN kernels, for anything that links the classifier (the node firmware, `classifier_bench`). Raspberry Pi's port; Apache 2.0. Not vendored ([design decision 12](../README.md#12-tensorflow-lite-micro-from-a-pinned-pico-tflmicro-checkout)) |

The script installs all of them (Homebrew on macOS, apt on Linux). It's safe to re-run:

```sh
scripts/install-firmware-tooling.sh          # from the repo root; DRY_RUN=1 to preview
export PICO_SDK_PATH="$HOME/pico/pico-sdk"   # add to ~/.bashrc or ~/.zshrc
```

The first node build compiles all of TFLM and takes a couple of minutes; later builds are incremental.

Check the SDK:

```sh
git -C "$PICO_SDK_PATH" describe --tags      # → 2.3.1
git -C "$PICO_SDK_PATH" submodule status     # 5 lines; a leading '-' means that submodule is empty
```

The script also clones `pico-tflmicro` at the pinned commit next to the SDK (`~/pico/pico-tflmicro`), which is where `firmware/classifier/classifier.cmake` looks by default, so no extra variable is needed. To keep it somewhere else, set the `PICO_TFLMICRO_PATH` environment variable when running the script, and the same path when building (environment variable, or `-DPICO_TFLMICRO_PATH=` at configure). An existing checkout is never changed: the script prints its commit, and if that isn't the pinned one, the commands to switch.

Check it:

```sh
git -C ~/pico/pico-tflmicro rev-parse --short HEAD   # → dfea53b
```

Without the script, fetch just that commit (~16 MB checked out, no submodules):

```sh
git init ~/pico/pico-tflmicro
git -C ~/pico/pico-tflmicro remote add origin https://github.com/raspberrypi/pico-tflmicro.git
git -C ~/pico/pico-tflmicro fetch --depth 1 origin dfea53b977f131dc50d7060568ad4fd355d4d71e
git -C ~/pico/pico-tflmicro checkout --detach FETCH_HEAD
```

---

## Smoke test

Build and flash the SDK's own examples before our code. If these work, the toolchain, SDK and board are fine, and any later problem is in our code.

```sh
git clone --depth 1 --branch sdk-2.3.1 https://github.com/raspberrypi/pico-examples.git ~/pico/pico-examples
cmake -S ~/pico/pico-examples -B ~/pico/pico-examples/build_pico2_w -G Ninja -DPICO_BOARD=pico2_w
cmake --build ~/pico/pico-examples/build_pico2_w --target picow_blink ble_temp_server
```

The configure step should print `Pico W Bluetooth build support available.` If it doesn't, the SDK submodules are missing.

Flash each one: hold **BOOTSEL** while plugging the board in, then

```sh
picotool load -x ~/pico/pico-examples/build_pico2_w/pico_w/wifi/blink/picow_blink.uf2
picotool load -x ~/pico/pico-examples/build_pico2_w/bluetooth/ble_temp_sensor/ble_temp_server.uf2
```

| Target | Expected | What it proves |
|---|---|---|
| `picow_blink` | onboard LED blinks | The LED is wired to the CYW43439, not to an RP2350 GPIO. A blink means the CYW43 driver started and uploaded the radio's firmware. |
| `ble_temp_server` | LED flashes once a second; a phone BLE scanner (nRF Connect) shows `Pico XX:XX:XX:XX:XX:XX` (the board's Bluetooth address) | BTstack runs and the radio advertises, which is exactly what the mesh's transmit side does |

Optional: `gap_le_advertisements` (same build) scans and prints every advertisement it hears, the mesh's receive side. It prints over UART0 (GP0 = TX, 115200 baud), so it needs a USB-serial adapter or the Pi 5's UART.

**Image sizes** (Release, `arm-none-eabi-size`, text):

| Image | text | of which CYW43439 firmware |
|---|---|---|
| `picow_blink` | 264,248 B | 225,240 B (Wi-Fi firmware, `w43439A0_7_95_49_00_combined`) |
| `ble_temp_server` | 405,908 B | 232,408 B (Wi-Fi + Bluetooth) + 6,970 B (`cyw43_btfw_43439`) |
| `gap_le_advertisements` | 320,568 B | |

The radio firmware is ~230 KB of the 4 MB flash, and it's there in every radio build. Budget the classifier model around it.

---

## Tools

Two standalone images in `firmware/tools/`, each its own CMake project with no radio code. Configure, build and flash from the repo root:

```sh
cmake -S firmware/tools/classifier_bench -B firmware/tools/classifier_bench/build -G Ninja
cmake --build firmware/tools/classifier_bench/build
picotool load -f -x firmware/tools/classifier_bench/build/classifier_bench.uf2
```

`classifier_bench` links the classifier, so it needs `pico-tflmicro` ([Prerequisites](#prerequisites)). It reports the arena size, inference time and scores for fixed test inputs over USB serial (`model/board_test.py` checks them against the PC), then live detections from the mic. `mic_capture` builds the same way (swap the name) and doesn't need `pico-tflmicro`; it streams the mic for `model/record.py`.

---

## Gotchas

- **Check that the board really is a W.** A plain Pico 2 (with headers: SC1632) looks almost the same as a Pico 2 W (with headers: SC1634) and runs radio images without crashing. The radio just never starts, and the LED stays steadily on, because on a Pico 2 the LED is on GP25, which the driver holds high as the radio's chip select. A Pico 2 W has a metal shield and an antenna at the end opposite the USB port.
- **The onboard LED is on the CYW43439**, not an RP2350 GPIO. `pico2_w.h` defines no `PICO_DEFAULT_LED_PIN`. Light it with `cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, 1)` after `cyw43_arch_init()`.
- **`cyw43_arch_init()` returning 0 doesn't mean the radio works.** It doesn't touch the chip; the chip is started on first use. Check the result of the first real radio call, and watch for `[CYW43] Failed to start CYW43` on stdio.
- **`pico_cyw43_arch_poll` without lwIP needs `CYW43_LWIP=0`.** The `poll` and `threadsafe_background` libraries default to lwIP on, and the build fails with `lwip/netif.h: No such file or directory`. Only `pico_cyw43_arch_none` sets it for you.
- **Clone the SDK with its submodules.** Without them, configure still succeeds and Bluetooth is just missing. The only signs are a CMake warning and `Skipping Pico Bluetooth examples as support is not available`, both easy to miss in the output.
- **pico-examples moved the Bluetooth examples.** In 2.3.x they're in top-level `bluetooth/`, not `pico_w/bt/` as older guides say.
- **`Skipping some Pico W examples as WIFI_SSID is not defined`** is expected. We don't use Wi-Fi on the nodes.
- **picotool ≥ 2.0.** 1.x doesn't know the RP2350. The SDK finds the Homebrew picotool (`Using picotool from /opt/homebrew/bin/picotool`); without one it downloads and builds picotool during the first build.
- **One SDK version.** pico-examples tracks the SDK, so mismatched versions can fail to build. Keep pico-examples on the matching `sdk-<version>` tag.
- **`pico-tflmicro not found at ...`** at configure means there's no checkout where `classifier.cmake` looks (it checks for `src/tensorflow/lite/micro/micro_interpreter.h`). Run `scripts/install-firmware-tooling.sh`, or point `PICO_TFLMICRO_PATH` at your checkout. The path is cached, so after fixing it delete the build directory (or pass `-DPICO_TFLMICRO_PATH=...`) and configure again.
- **Stay on `pico-tflmicro` `dfea53b`.** It's the commit the classifier was built and measured on. `classifier.cmake` globs its sources and carries two workarounds for it under GCC 15 (`-include cstdint`, `ARDUINO=1`), so another commit may not build or may give different numbers.
- **Mic VDD goes on pin 36, 3V3(OUT).** Pin 37 next to it is 3V3_EN, the regulator's enable input: a mic there gets no real power and can reset the board. Pins 39 (VSYS) and 40 (VBUS) are ~5 V, above the INMP441's 3.63 V maximum.
- **A silent mic is usually a connection, or a bitstream module.** If a node prints `[listen] mic + classifier running on core 1` but never detects anything, swap mic modules with a working node: if the fault moves, it's the module or its wires (reflow the header joints, try other dupont wires). L/R must be tied to GND, and WS must be on GP4, right after SCK on GP3.
- **The classifier reports an event when it ends,** about 1.5 s after the sound stops, so a detection line appears after you've finished whistling, not during.

---

## Next steps

1. **Hardware test of the combined build** (mic + classifier + dedup + tx queue + relaying): a whistle at one node, relayed by another, received by a third.
2. **End-to-end with the base station** (`base-station/`, PR #7): a whistle at a node, decoded on the Pi.
3. **Location check with calibration:** per-node offsets are in `calib_table` in `audio/listen.c` (measured 2026-11-14); the node closest to a sound should report the highest `peak_level`.
4. **Heartbeat payload:** agree it with the base station and app (the app currently proposes battery and millivolts).

---

## References

- Local copies in [`docs/refs/firmware/`](../docs/refs/firmware/): the RP2350 datasheet, the Pico 2 W datasheet, pinout and schematic, *Getting started with Raspberry Pi Pico*, and *Connecting to the internet with Raspberry Pi Pico W* (covers the CYW43 and Bluetooth setup).
- [Pico SDK](https://github.com/raspberrypi/pico-sdk) and [pico-examples](https://github.com/raspberrypi/pico-examples), tag `2.3.1` / `sdk-2.3.1`.
- [BTstack](https://github.com/bluekitchen/btstack) documentation for the GAP advertising and scanning API.
