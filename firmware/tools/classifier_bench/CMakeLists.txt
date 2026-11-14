# classifier_bench: runs the classifier on a Pico 2 W and reports over USB serial: arena
# size, inference time, scores for fixed test inputs (model/board_test.py checks them
# against the PC), then live detections from the mic. A separate build from the node
# firmware; no radio code is linked.
#
# Configure, build and flash:
#   cmake -S firmware/tools/classifier_bench -B firmware/tools/classifier_bench/build -G Ninja
#   cmake --build firmware/tools/classifier_bench/build
#   picotool load -f -x firmware/tools/classifier_bench/build/classifier_bench.uf2
#
# Needs a pico-tflmicro checkout (scripts/install-firmware-tooling.sh clones it; see
# firmware/classifier/classifier.cmake).

cmake_minimum_required(VERSION 3.13)

# Default to the Pico 2 W if -DPICO_BOARD isn't given. Must be set before the SDK is imported.
set(PICO_BOARD pico2_w CACHE STRING "Board type")

# The node firmware's SDK import: finds the SDK via $PICO_SDK_PATH and sets up the
# arm-none-eabi toolchain. Must come before project().
include(${CMAKE_CURRENT_LIST_DIR}/../../pico_sdk_import.cmake)

project(serra_classifier_bench C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

pico_sdk_init()

# The mic driver is shared with the node firmware; the classifier comes in as a library.
set(AUDIO_DIR ${CMAKE_CURRENT_LIST_DIR}/../../audio)
include(${CMAKE_CURRENT_LIST_DIR}/../../classifier/classifier.cmake)

add_executable(classifier_bench
    main.c
    ${AUDIO_DIR}/mic.c
)

# Assembles the PIO program into i2s_mic.pio.h.
pico_generate_pio_header(classifier_bench ${AUDIO_DIR}/i2s_mic.pio)

target_include_directories(classifier_bench PRIVATE ${AUDIO_DIR})

target_link_libraries(classifier_bench
    serra_classifier   # features + TFLM model (firmware/classifier/classifier.cmake)
    pico_stdlib        # GPIO, timers, stdio
    hardware_pio       # I2S clocks and sample shifting for the mic
    hardware_dma       # mic samples into the ring buffer
)

# Reports go out over USB serial; UART stays off.
pico_enable_stdio_usb(classifier_bench 1)
pico_enable_stdio_uart(classifier_bench 0)

# classifier_bench.uf2, .bin, .hex, .dis, .map next to classifier_bench.elf.
pico_add_extra_outputs(classifier_bench)
