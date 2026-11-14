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

add_executable(node
    main.c
    runtime/scheduler.c
    blink_light/blink_light.c
)

# btstack_config.h lives next to this file; BTstack includes it by name.
target_include_directories(node PRIVATE ${CMAKE_CURRENT_LIST_DIR})

# Bluetooth only, no IP stack: poll mode defaults to lwIP on, so turn it off.
target_compile_definitions(node PRIVATE
    CYW43_LWIP=0
)

target_link_libraries(node
    pico_stdlib            # GPIO, timers, stdio
    pico_cyw43_arch_poll   # radio driver; work happens only when the runtime calls cyw43_arch_poll()
    pico_btstack_ble       # BTstack, LE only
    pico_btstack_cyw43     # BTstack transport over the CYW43439
)

# printf over USB serial (/dev/cu.usbmodem*), not UART0. Also lets `picotool load -f`
# reboot a running board into BOOTSEL without the button.
pico_enable_stdio_usb(node 1)
pico_enable_stdio_uart(node 0)

# node.uf2, .bin, .hex, .dis, .map next to node.elf.
pico_add_extra_outputs(node)
