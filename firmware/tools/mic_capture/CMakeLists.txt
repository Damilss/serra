# mic_capture: streams the INMP441 over USB serial so model/record.py can record training
# data through the real mic. A separate build from the node firmware.
#
#   cmake -S firmware/tools/mic_capture -B firmware/tools/mic_capture/build -G Ninja
#   cmake --build firmware/tools/mic_capture/build
#   picotool load -f -x firmware/tools/mic_capture/build/mic_capture.uf2
#
# No radio code is linked, so this runs on a Pico 2 W and a plain Pico 2 alike.

cmake_minimum_required(VERSION 3.13)

set(PICO_BOARD pico2_w CACHE STRING "Board type")

include(${CMAKE_CURRENT_LIST_DIR}/../../pico_sdk_import.cmake)

project(serra_mic_capture C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

pico_sdk_init()

set(AUDIO_DIR ${CMAKE_CURRENT_LIST_DIR}/../../audio)

add_executable(mic_capture
	main.c
	${AUDIO_DIR}/mic.c
)

# Assembles the PIO program into i2s_mic.pio.h.
pico_generate_pio_header(mic_capture ${AUDIO_DIR}/i2s_mic.pio)

target_include_directories(mic_capture PRIVATE ${AUDIO_DIR})

target_link_libraries(mic_capture
	pico_stdlib
	hardware_pio
	hardware_dma
)

# Audio goes out over USB serial; UART stays off.
pico_enable_stdio_usb(mic_capture 1)
pico_enable_stdio_uart(mic_capture 0)

pico_add_extra_outputs(mic_capture)
