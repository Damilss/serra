# firmware

Firmware for the Serra field nodes: Raspberry Pi Pico 2 W (RP2350, Arm Cortex-M33, CYW43439 radio). See the [project README](../README.md) for what the nodes do and why.

The firmware builds on the **Pico SDK 2.3.1** ([design decision 6](../README.md#6-keep-the-pico-sdks-radio-driver)). The SDK provides the startup code, hardware drivers, the CYW43 radio driver and the BTstack Bluetooth stack. Our code (runtime, audio, classifier, mesh) sits on top.

---

## Table of contents

1. [Status](#status)
2. [Layout](#layout)
3. [Prerequisites](#prerequisites)
4. [Smoke test](#smoke-test)
5. [Gotchas](#gotchas)
6. [Next steps](#next-steps)
7. [References](#references)

---

## Status

| Piece | State |
|---|---|
| Toolchain + Pico SDK 2.3.1 install (`scripts/install-firmware-tooling.sh`) | Done (macOS) |
| SDK images on hardware (build info, timers, USB stdio) | Done |
| SDK smoke test: `picow_blink` (onboard LED through the CYW43) | Builds; **not yet run on a Pico 2 W** |
| SDK smoke test: `ble_temp_server` (BLE advertising) | Builds; **not yet run on a Pico 2 W** |
| BLE advertise test with our packet format | Not started |
| `runtime/`, `audio/`, `classifier/`, `mesh/` | Empty placeholders |

---

## Layout

```
firmware/
├── CMakeLists.txt     # SDK build for PICO_BOARD=pico2_w
├── btstack_config.h   # (planned) BTstack options; the pico_btstack_* libraries require it
├── main.c             # application entry
├── runtime/           # scheduler / power management (planned)
├── audio/             # mic capture, wake trigger (planned)
├── classifier/        # int8 model + inference (planned)
├── mesh/              # BLE flooding (planned)
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

The script installs all of them (Homebrew on macOS, apt on Linux). It's safe to re-run:

```sh
scripts/install-firmware-tooling.sh          # from the repo root; DRY_RUN=1 to preview
export PICO_SDK_PATH="$HOME/pico/pico-sdk"   # add to ~/.bashrc or ~/.zshrc
```

Check the SDK:

```sh
git -C "$PICO_SDK_PATH" describe --tags      # → 2.3.1
git -C "$PICO_SDK_PATH" submodule status     # 5 lines; a leading '-' means that submodule is empty
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

---

## Next steps

1. **First build of our own firmware:** `CMakeLists.txt` is in place; add `btstack_config.h` and a `main.c` that advertises a `mesh_pkt_t` (see the README's [packet format](../README.md#packet-format-proposed)), checked with a phone scanner or the Pi 5.

---

## References

- Local copies in [`docs/refs/firmware/`](../docs/refs/firmware/): the RP2350 datasheet, the Pico 2 W datasheet, pinout and schematic, *Getting started with Raspberry Pi Pico*, and *Connecting to the internet with Raspberry Pi Pico W* (covers the CYW43 and Bluetooth setup).
- [Pico SDK](https://github.com/raspberrypi/pico-sdk) and [pico-examples](https://github.com/raspberrypi/pico-examples), tag `2.3.1` / `sdk-2.3.1`.
- [BTstack](https://github.com/bluekitchen/btstack) documentation for the GAP advertising and scanning API.
