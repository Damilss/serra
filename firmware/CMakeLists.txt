# Firmware build for the field nodes (Pico 2 W: RP2350 + CYW43439).
#
# Configure and build (one build directory per board; PICO_BOARD is cached):
#   cmake -S firmware -B firmware/build -G Ninja -DPICO_BOARD=pico2_w
#   cmake --build firmware/build
# Output: firmware/build/node.uf2 (flash with `picotool load -x`), plus .elf/.bin/.hex/.dis/.map.

cmake_minimum_required(VERSION 3.13)

# Default to the Pico 2 W if -DPICO_BOARD isn't given. Must be set before the SDK is imported.
set(PICO_BOARD pico2_w CACHE STRING "Board type")

# Finds the SDK via $PICO_SDK_PATH and sets up the arm-none-eabi toolchain.
# Must come before project().
include(pico_sdk_import.cmake)

project(serra_firmware C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

# compile_commands.json for clangd (.clangd -> CompilationDatabase).
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if (PICO_SDK_VERSION_STRING VERSION_LESS "2.3.1")
    message(FATAL_ERROR "Pico SDK 2.3.1 or later required, found ${PICO_SDK_VERSION_STRING}")
endif()

pico_sdk_init()

# The classifier (TensorFlow Lite Micro + model + features) as the
# `serra_classifier` library. Needs a pico-tflmicro checkout: see
# classifier/classifier.cmake (default: a pico-tflmicro folder next to the SDK).
include(${CMAKE_CURRENT_LIST_DIR}/classifier/classifier.cmake)

add_executable(node
    main.c
    audio/listen.c
    audio/mic.c
    blink_light/blink_light.c
    mesh/ble.c
    mesh/mesh.c
    mesh/tx_queue.c
    mesh/console.c
    runtime/ipc.c
)

# Optional once-a-second mic level line on serial (audio/listen.c), for checking mic
# wiring and for the reference-tone calibration:
#   cmake -S firmware -B firmware/build -DSERRA_LISTEN_DEBUG=ON
option(SERRA_LISTEN_DEBUG "Print the mic level once a second" OFF)
if (SERRA_LISTEN_DEBUG)
    target_compile_definitions(node PRIVATE LISTEN_DEBUG=1)
endif()

# PIO program for the INMP441 (I2S) -> i2s_mic.pio.h for audio/mic.c.
pico_generate_pio_header(node ${CMAKE_CURRENT_LIST_DIR}/audio/i2s_mic.pio)

# btstack_config.h lives next to this file; BTstack includes it by name.
target_include_directories(node PRIVATE ${CMAKE_CURRENT_LIST_DIR})

# Bluetooth only, no IP stack: poll mode defaults to lwIP on, so turn it off.
target_compile_definitions(node PRIVATE
    CYW43_LWIP=0
    # core 1 (classifier_init) mallocs while core 0 runs: make malloc safe across cores
    PICO_USE_MALLOC_MUTEX=1
    # at boot, wait up to 3 s for a serial monitor so the startup log isn't lost
    PICO_STDIO_USB_CONNECT_WAIT_TIMEOUT_MS=3000
)

# Optional log of every tx-queue switch (mesh/tx_queue.c). Very noisy, so off by default:
#   cmake -S firmware -B firmware/build -DSERRA_TXQ_DEBUG=ON
option(SERRA_TXQ_DEBUG "Log every tx-queue switch on serial" OFF)
if (SERRA_TXQ_DEBUG)
    target_compile_definitions(node PRIVATE TXQ_DEBUG=1)
endif()

target_link_libraries(node
    pico_stdlib            # GPIO, timers, stdio
    pico_cyw43_arch_poll   # radio driver; work happens only when the runtime calls cyw43_arch_poll()
    pico_btstack_ble       # BTstack, LE only
    pico_btstack_cyw43     # BTstack transport over the CYW43439
    pico_unique_id         # board ID -> mesh node ID
    pico_rand              # random msg_id seed at boot
    pico_multicore         # core 1 runs the mic + classifier (audio/listen.c)
    hardware_pio           # INMP441 I2S capture (audio/mic.c)
    hardware_dma           # mic samples -> ring buffer without the CPU
    serra_classifier       # TFLM + int8 model + features (classifier/classifier.cmake)
)

# printf over USB serial (/dev/cu.usbmodem*), not UART0. Also lets `picotool load -f`
# reboot a running board into BOOTSEL without the button.
pico_enable_stdio_usb(node 1)
pico_enable_stdio_uart(node 0)

# node.uf2, .bin, .hex, .dis, .map next to node.elf.
pico_add_extra_outputs(node)
