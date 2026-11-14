# flashing pico instructions

## Overview
flashing pico instructions contains the process for using pico-sdk and picotool to flash the pico 2 & pico 2 W,
as well as other useful tips.

---

## Table of contents

1. [Which board do I have?](#which-board-do-i-have)
2. [One-time setup](#one-time-setup)
3. [Build](#build)
4. [Put the board in BOOTSEL mode](#put-the-board-in-bootsel-mode)
5. [Flash](#flash)
6. [Check the image](#check-the-image)
7. [Watch the output](#watch-the-output)
8. [Blink the LED on both boards](#blink-the-led-on-both-boards)
9. [Troubleshooting](#troubleshooting)

---

## Which board do I have?

| | Pico 2 | Pico 2 W |
|---|---|---|
| Chip | RP2350 | RP2350 + CYW43439 radio |
| Look | no shield | metal shield and antenna at the end opposite the USB port |
| Part number (with headers) | SC1632 | SC1634 |
| `PICO_BOARD` | `pico2` | `pico2_w` |
| Onboard LED | GP25, driven by `hardware_gpio` | on the CYW43439, driven by `cyw43_arch_gpio_put()` |

A plain Pico 2 runs a `pico2_w` image without crashing, but the radio never starts and the LED stays on. Check the board before blaming the code.

---

## One-time setup

```sh
scripts/install-firmware-tooling.sh                 # arm-none-eabi-gcc, cmake, ninja, picotool, SDK 2.3.1, pico-tflmicro
export PICO_SDK_PATH="$HOME/pico/pico-sdk"          # add to ~/.bashrc or ~/.zshrc
cp "$PICO_SDK_PATH/external/pico_sdk_import.cmake" firmware/
picotool version                                    # must be ≥ 2.0 (1.x doesn't know the RP2350)
```

---

## Build

Use one build directory per board. `PICO_BOARD` is cached, so don't switch boards inside an existing build directory.

```sh
# Pico 2 W
cmake -S firmware -B firmware/build -G Ninja -DPICO_BOARD=pico2_w
cmake --build firmware/build

# plain Pico 2
cmake -S firmware -B firmware/build_pico2 -G Ninja -DPICO_BOARD=pico2
cmake --build firmware/build_pico2
```

`pico_add_extra_outputs()` in `CMakeLists.txt` writes `node.uf2`, `.elf`, `.bin`, `.hex`, `.dis` and `.map` next to each other in the build directory.

---

## Put the board in BOOTSEL mode

1. Unplug the board.
2. Hold **BOOTSEL**.
3. Plug in USB and release the button.

The board shows up as a USB drive called `RP2350`, and `picotool info` finds it.

If the running image has USB stdio enabled (`pico_enable_stdio_usb(node 1)`), you don't need the button: `picotool ... -f` reboots it into BOOTSEL for you.

---

## Flash

| Command | What it does |
|---|---|
| `picotool load -x firmware/build/node.uf2` | write the image and run it (board already in BOOTSEL) |
| `picotool load -f -x firmware/build/node.uf2` | force a running board (with USB stdio) into BOOTSEL, then write and run |
| `picotool load -v -x firmware/build/node.uf2` | same, and read the flash back to verify it |
| `cp firmware/build/node.uf2 /Volumes/RP2350/` | drag-and-drop alternative; the board reboots by itself when the copy finishes |
| `picotool reboot` | leave BOOTSEL and run what's in flash |

Wipe the flash completely: build `flash_nuke` from pico-examples (`flash/nuke`) and load it like any other image.

---

## Check the image

```sh
picotool info -a firmware/build/node.uf2     # inspect the file
picotool info -a                             # inspect the board (in BOOTSEL)
```

Look for `pico_board: pico2_w` (or `pico2`) and `sdk version: 2.3.1`. If the board name is wrong, you flashed the wrong build directory.

---

## Watch the output

With USB stdio enabled, `printf` output arrives on a USB serial port:

```sh
ls /dev/cu.usbmodem*
screen /dev/cu.usbmodem* 115200      # quit: Ctrl-A, then K
```

The port disappears while the board is in BOOTSEL and comes back after the image starts. Reopen `screen` after each flash.

---

## Blink the LED on both boards

Plain Pico 2 (`PICO_BOARD=pico2`, link `pico_stdlib`):

```c
#include "pico/stdlib.h"

int main(void) {
    gpio_init(PICO_DEFAULT_LED_PIN);          // GP25
    gpio_set_dir(PICO_DEFAULT_LED_PIN, GPIO_OUT);
    while (true) {
        gpio_put(PICO_DEFAULT_LED_PIN, 1); sleep_ms(250);
        gpio_put(PICO_DEFAULT_LED_PIN, 0); sleep_ms(250);
    }
}
```

Pico 2 W (`PICO_BOARD=pico2_w`, link `pico_stdlib pico_cyw43_arch_none`):

```c
#include "pico/stdlib.h"
#include "pico/cyw43_arch.h"

int main(void) {
    stdio_init_all();
    if (cyw43_arch_init()) return 1;          // 0 doesn't prove the radio works, see Troubleshooting
    while (true) {
        cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, 1); sleep_ms(250);
        cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, 0); sleep_ms(250);
    }
}
```

`PICO_DEFAULT_LED_PIN` isn't defined for `pico2_w`, so the first program only compiles for `pico2`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `picotool` says no device found | board isn't in BOOTSEL: redo the button sequence, or use `-f` if the image has USB stdio. Try another cable, since charge-only cables don't carry data |
| LED steadily on, no blink, on a "W" image | the board is a plain Pico 2: GP25 is the radio's chip select, held high. Rebuild with `PICO_BOARD=pico2` |
| `[CYW43] Failed to start CYW43` on serial | same as above, or a radio fault. `cyw43_arch_init()` returning 0 doesn't touch the chip |
| `PICO_DEFAULT_LED_PIN undeclared` | building GPIO-LED code for `pico2_w`. Use the CYW43 version, or build for `pico2` |
| no `/dev/cu.usbmodem*` | image has no USB stdio (`pico_enable_stdio_usb`), or `stdio_init_all()` isn't called, or the image crashed before it ran |
| picotool reports an unknown chip | picotool 1.x. Install ≥ 2.0 |
| board name in `picotool info` is wrong | flashed from the wrong build directory |
