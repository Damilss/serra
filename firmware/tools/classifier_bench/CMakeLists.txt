# classifier_bench: runs the classifier on a Pico 2 W and reports over USB serial: arena
# size, inference time, scores for fixed test inputs (model/board_test.py checks them
# against the PC), then live detections from the mic. A separate build from the node
# firmware; no radio code is linked.
#
#   cmake -S firmware/tools/classifier_bench -B firmware/tools/classifier_bench/build -G Ninja
#   cmake --build firmware/tools/classifier_bench/build
#   picotool load -f -x firmware/tools/classifier_bench/build/classifier_bench.uf2
#
# Needs a pico-tflmicro checkout: see firmware/classifier/classifier.cmake.

cmake_minimum_required(VERSION 3.13)

set(PICO_BOARD pico2_w CACHE STRING "Board type")

include(${CMAKE_CURRENT_LIST_DIR}/../../pico_sdk_import.cmake)

project(serra_classifier_bench C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

pico_sdk_init()

set(AUDIO_DIR ${CMAKE_CURRENT_LIST_DIR}/../../audio)
include(${CMAKE_CURRENT_LIST_DIR}/../../classifier/classifier.cmake)

add_executable(classifier_bench
	main.c
	${AUDIO_DIR}/mic.c
)

pico_generate_pio_header(classifier_bench ${AUDIO_DIR}/i2s_mic.pio)

target_include_directories(classifier_bench PRIVATE ${AUDIO_DIR})

target_link_libraries(classifier_bench
	serra_classifier
	pico_stdlib
	hardware_pio
	hardware_dma
)

pico_enable_stdio_usb(classifier_bench 1)
pico_enable_stdio_uart(classifier_bench 0)

pico_add_extra_outputs(classifier_bench)
