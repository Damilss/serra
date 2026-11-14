# CPU architecture: Arm vs. RISC-V on the RP2350

**Status:** Decided. We build the Arm (Cortex-M33) `pico2_w` target only. RISC-V (Hazard3) is future work, not part of the demo. The analysis below is kept as the reasoning behind the choice.

---

## Context

The Pico 2 W's RP2350 has two pairs of cores:

- **2× Arm Cortex-M33:** hardware single-precision FPU, DSP instructions.
- **2× Hazard3 RISC-V (RV32):** small, open-source cores. No FPU, no DSP/SIMD instructions.

The chip boots with one pair active, and the Pico SDK builds for one architecture at a time (selected via the target platform at build time). We plan on one architecture per build rather than mixing.

Serra nodes are **battery-powered and deployed in the field**, so the question isn't "which core is faster?" but **"which core gives the best battery life?"**

---

## Speed vs. power

### Speed only matters as energy

Energy = power × time. A core that finishes inference quickly and returns to sleep can use **less total energy** than a core that draws slightly less power but runs longer. This is called **race to sleep**.

The M33's DSP instructions and Arm's optimized libraries (CMSIS-NN, CMSIS-DSP, used by TensorFlow Lite Micro) probably finish our audio features and int8 inference faster, which probably means **less energy per inference** on Arm.

"Probably" is deliberate: we haven't found solid published Arm vs. Hazard3 energy numbers for the RP2350. **We will measure it.**

### The core choice barely affects battery life

The classifier only runs when the cheap wake trigger fires, which is rare. Battery life is dominated by:

1. **The radio:** BLE scanning so nodes can relay alerts. Likely the largest drain by far.
2. **Always-on listening:** the microphone and wake trigger.
3. **Sleep quality:** how deeply and how often the chip sleeps between tasks.

A few milliseconds of inference now and then is small compared with these. **The biggest power wins come from the runtime, not the core choice:**

- radio scan/advertise duty cycling
- sleep/wake management
- clock scaling (run slower when idle)
- keeping the second core off unless it's needed
- PIO + DMA mic capture so the CPU can sleep while samples stream in

---

## Options

| | Arm Cortex-M33 | Hazard3 RISC-V |
|---|---|---|
| FPU | Yes (single precision) | No |
| DSP instructions | Yes | No |
| Optimized ML/DSP libraries | CMSIS-NN, CMSIS-DSP (used by TFLite Micro) | Mostly plain C |
| Energy per inference | Probably lower (race to sleep) | Probably slightly higher |
| Effect on overall battery life | Small | Small |
| SDK / BLE maturity | Most-tested path | Supported; confirm BLE works early |
| Weekend risk | Low | Moderate |
| Team passion / differentiator | Standard | High; few teams will touch it |

---

## Decision

**Arm Cortex-M33, only.**
Lowest risk, best libraries, and likely slightly lower energy per inference. The classifier now covers whistles, screams and the spoken keyword "help" (a `micro_speech`-style log-mel CNN), not just simple band-energy DSP, so the FPU, DSP instructions and TensorFlow Lite Micro's optimized Arm kernels matter more than they did. The demo has to work.

**Future work: RISC-V Hazard3.** Not in the demo. If there's time afterwards:
- Build the same firmware for RISC-V.
- Hand-write the hot inference loop in RISC-V assembly.
- Compare Arm vs. RISC-V on speed and energy per inference.

---

## Core allocation

| Resource | Responsibility |
|---|---|
| **Core 0** | Radio and mesh (BLE stack, flooding, relaying) in a `cyw43_arch_poll()` main loop |
| **Core 1** | Audio: the cheap wake trigger runs on every audio block; feature extraction and the classifier run only when it fires |
| **PIO + DMA** | Read the INMP441 over I2S and stream samples into memory without the CPU |

Radio and mesh stay on core 0 because the CYW43 driver and BTstack are initialized there and their work runs when core 0 polls them (`pico_cyw43_arch_poll`). The Arm vs. RISC-V choice doesn't change this split.

**Fallback:** if dual-core coordination causes trouble, run everything on core 0. The workload is light enough for one core in the demo; split later.

---

## What we'll measure

- [ ] Inference time and energy per inference on Arm
- [ ] Average node current in each node state (`LISTEN`, `CLASSIFY`, `TRANSMIT`, `IDLE`)
- [ ] Share of total energy spent on radio vs. listening vs. inference
- [ ] Estimated battery life for a node
- [ ] *(Future work)* the same numbers on RISC-V, with and without hand-written kernels

**Slide story:** the radio dominates the energy budget, so we optimized radio duty cycling and gated the classifier rather than optimizing the math, and here are the numbers that show where the energy actually goes.
