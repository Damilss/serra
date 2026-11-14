# RP2350 Memory Map

A compact reference for the RP2350 / Raspberry Pi Pico 2 W memory map.

## High-Level Memory Map

```text
0x00000000  ─────────────────────────────
            Boot ROM
            - Immutable code built into the chip
            - First code executed after reset

0x10000000  ─────────────────────────────
            XIP / External Flash Window
            - Firmware usually lives here
            - CPU can fetch instructions directly from flash
            - "Execute in place"

0x20000000  ─────────────────────────────
            SRAM
            - Stack
            - .data
            - .bss
            - Heap
            - Runtime variables and buffers

0x40000000  ─────────────────────────────
            APB Peripherals
            - GPIO configuration
            - UART
            - SPI
            - I2C
            - Timers
            - PWM
            - Clocks
            - Resets
            - ADC
            - etc.

0x50000000  ─────────────────────────────
            AHB Peripherals
            - Higher-bandwidth peripherals

0xD0000000  ─────────────────────────────
            SIO
            - Fast GPIO access
            - Core-local functionality
            - Spinlocks
            - Inter-core FIFO
            - etc.

0xE0000000  ─────────────────────────────
            Cortex-M33 Private Peripheral Space
            - NVIC
            - SysTick
            - Debug/control registers
            - ARM core-specific hardware
```

## SRAM

The main SRAM region begins at:

```text
0x20000000
```

RP2350 has 520 KiB total SRAM. The main striped SRAM banks occupy the lower part of this region, followed by two additional 4 KiB banks near the top.

Useful mental model:

```text
0x20000000  -> SRAM begins
...
0x20080000  -> extra SRAM bank
0x20081000  -> extra SRAM bank
0x20082000  -> end of SRAM region (exclusive)
```

## Useful Peripheral Base Addresses

```text
0x40020000   RESETS
0x40028000   IO_BANK0
0x40038000   PADS_BANK0

0x40070000   UART0
0x40078000   UART1

0x40080000   SPI0
0x40088000   SPI1

0x40090000   I2C0
0x40098000   I2C1

0x400A0000   ADC
0x400A8000   PWM

0xD0000000   SIO
```

### GPIO-Related Blocks

- **IO_BANK0 (`0x40028000`)**  
  Used for GPIO function selection, control, and interrupt-related configuration.

- **PADS_BANK0 (`0x40038000`)**  
  Used for electrical pad configuration such as pulls, drive strength, and related pad behavior.

- **SIO (`0xD0000000`)**  
  Used for fast GPIO input/output operations and other core-local facilities.

## How This Relates to Bare-Metal GPIO

A typical bare-metal GPIO program conceptually does this:

```text
FLASH
0x1000....
    |
    | CPU executes instructions from here
    v

Instructions perform loads/stores to:

0x40028000    configure GPIO function
0x40038000    configure electrical pad
0xD0000000+   set/clear/read GPIO state
```

## Memory-Mapped I/O

The important idea is that code, RAM, and hardware registers all occupy the same CPU address space.

From the CPU's perspective, instructions such as:

```asm
ldr
str
```

can access either:

```text
0x20000100   -> ordinary SRAM data
```

or:

```text
0x40028000   -> peripheral register
```

The address decoder determines whether the transaction goes to RAM, flash, or a hardware peripheral.

## Full Mental Picture

```text
                  32-bit address space

0xFFFFFFFF  ┌──────────────────────────┐
            │                          │
0xE0000000  │ Cortex-M33 core hardware│
            ├──────────────────────────┤
0xD0000000  │ SIO / fast GPIO         │
            ├──────────────────────────┤
            │      reserved/etc.       │
            ├──────────────────────────┤
0x50000000  │ AHB peripherals          │
            ├──────────────────────────┤
0x40000000  │ APB peripherals          │
            ├──────────────────────────┤
            │                          │
0x20000000  │ SRAM                     │
            ├──────────────────────────┤
            │                          │
0x10000000  │ XIP / external flash     │
            ├──────────────────────────┤
0x00000000  │ Boot ROM                 │
            └──────────────────────────┘
```

## Linker-Script Connection

This memory map is what your linker script is targeting.

For example:

```ld
MEMORY
{
    FLASH (rx)  : ORIGIN = 0x10000000, LENGTH = ...
    RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = ...
}
```

Conceptually:

```text
Linker script says where sections belong
            ↓
ELF records that layout
            ↓
Loader / boot process places or exposes the image appropriately
            ↓
CPU executes code and accesses RAM/peripherals at those addresses
```

A useful summary:

> **The linker decides where sections live, the loader/boot process gets the image into place, and the CPU uses the memory map to access flash, RAM, and hardware registers.**
