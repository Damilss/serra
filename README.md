<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="serra_brand/logos/svg/serra-lockup-on-dark.svg">
    <img alt="Serra" src="serra_brand/logos/svg/serra-lockup-on-light.svg" height="96">
  </picture>
</p>

# Serra

**Off-grid search and rescue mesh.** Serra is the system: **Serranodes** (Raspberry Pi Pico 2 W) form the **Serranet** mesh. Serranodes run a custom low-power runtime and an on-device AI classifier that detects distress whistles. Alerts hop across a BLE mesh to a Pi 5 base station, which maps which node heard it, guiding rescuers to lost hikers where there's no cell service. No cloud, no internet.

> Built over a weekend at an AI hackathon by a team that would rather write firmware than another SaaS wrapper.

---

## Table of contents

1. [The problem](#the-problem)
2. [How it works](#how-it-works)
3. [Hardware](#hardware)
4. [System architecture](#system-architecture)
5. [Design decisions](#design-decisions)
6. [Mesh protocol (Serranet)](#mesh-protocol-serranet)
7. [Low-power runtime](#low-power-runtime)
8. [Audio classifier pipeline](#audio-classifier-pipeline)
9. [Base station](#base-station)
10. [Demo](#demo)
11. [Known limitations and open questions](#known-limitations-and-open-questions)
12. [Future work](#future-work)
13. [Repository layout](#repository-layout-proposed)
14. [Brand](#brand)
15. [License](#license)

---

## The problem

People get lost in secluded areas such as trails, forests and canyons, exactly where there is no cell service. Hikers are taught to carry a whistle, and three blasts is a recognized distress signal, but a whistle only helps if someone is close enough to hear it.

**Serra** puts cheap, battery-powered listening nodes (Serranodes) across an area. Each node listens for distress whistles using an AI model running on the microcontroller itself. When one hears something, the alert hops node to node across the Serranet until it reaches a base station, which shows rescuers *where* it was heard.

Everything runs locally. Out there, the cloud isn't an option.

---

## How it works

```
   Field (battery-powered Serranodes)                 Ranger station / trailhead

   [Node 1] ))) [Node 2] ))) [Node 3] ))) BLE ))) [ Pi 5 base station ]
                    ^                                      |
                    |                                      v
      whistle / scream / "help" heard here        Map dashboard over local Wi-Fi
                                                  (open on any phone, no internet)
```

1. **Listen cheaply.** Each node samples its microphone using a cheap loudness/frequency check that runs almost all the time.
2. **Classify rarely.** When the check fires, the node wakes the AI classifier, which decides whether it's a whistle, a scream, someone shouting "help", or nothing to worry about (and how confident it is).
3. **Alert.** On a positive detection, the node builds a small alert packet (node ID, sequence number, class, confidence, loudness in dB, time) and broadcasts it over BLE.
4. **Hop.** Every node that hears a new alert re-broadcasts it, so it floods across the mesh until it reaches the base station.
5. **Locate.** The Pi 5 base station collects alerts and lights up the node(s) that heard the call on a map. If several nodes heard it, the loudest one gives a rough location.

---

## Hardware

| Part | Qty | Role |
|---|---|---|
| Raspberry Pi Pico 2 W | 3+ | Field nodes |
| INMP441 I2S MEMS microphone | 1 per node | Audio input; the Pico has no built-in mic. L/R pin tied to GND (left channel) |
| Raspberry Pi 5 | 1 | Base station, extra BLE node, dashboard host |
| Batteries / USB power banks | 1 per node | Field power |

**Pico 2 W at a glance:** RP2350 microcontroller with a choice of dual Arm Cortex-M33 or dual Hazard3 RISC-V cores (we build for Arm), 520 KB SRAM, 4 MB flash, PIO state machines, and an Infineon CYW43439 radio (2.4 GHz Wi-Fi + Bluetooth LE).

**Fallback node:** if a board is missing, a phone running a BLE scanner/advertiser app (e.g. nRF Connect) can stand in as a node to show a multi-hop path.

---

## System architecture

### Field node: Serranode (Pico 2 W, C, Pico SDK)

```
+---------------------------------------------------------+
|                      Application                        |
|      detection -> alert packet -> mesh send             |
+--------------+---------------+--------------------------+
| Audio        | Classifier    | Mesh                     |
| INMP441 via  | wake trigger, | BLE advertise / scan,    |
| PIO I2S +    | features,     | flooding, dedup, TTL,    |
| DMA          | int8 model    | jitter                   |
|              | (TFLM)        |                          |
+--------------+---------------+--------------------------+
|   Thin runtime glue: node states, duty cycling          |
+---------------------------------------------------------+
|   Pico SDK: async_context, alarms, multicore, PIO/DMA,  |
|   CYW43 radio driver, BTstack Bluetooth stack           |
+---------------------------------------------------------+
|                 RP2350 + CYW43439                       |
+---------------------------------------------------------+
```

### Base station (Raspberry Pi 5, Python)

```
BLE scanner (bleak) -> packet decoder -> dedup by msg_id -> alert store -> web dashboard (map)
                                                                     \-> optional: local LLM summaries
```

---

## Design decisions

This section records what we considered, what we chose, and why.

### 1. Low-level, local AI instead of a SaaS app

**Decision:** Build on microcontrollers with on-device inference.

**Why:** Our team's strengths are embedded systems, C/C++, RISC-V assembly, OS and architecture work, serial comms, plus Python and DevOps. We care about local AI and individual sovereignty. Most hackathon teams build an app that calls a cloud API; we wanted a project where the AI runs on a cheap chip, uses tiny amounts of energy, and doesn't need the internet at all. For search and rescue, "no internet" isn't a philosophy, it's the environment.

### 2. Which project: ideas we considered

Early brainstorming produced several routes:

| Idea | Why it was interesting | Outcome |
|---|---|---|
| Appliance fingerprinting from a power line (NILM) | Great energy + privacy story, easy live demo | Dropped in favour of a mesh-based idea |
| Energy-aware / battery-free inference | Strong systems angle | Folded in as the low-power runtime |
| Hand-tuned RISC-V inference kernels | Shows off RISC-V asm, measurable energy wins | Moved to future work (Arm-only build for the demo) |
| Tiny LLM on a Pico (llama2.c-style) | "Smallest possible local AI" | Not chosen |
| Distributed inference across two Picos | Pipeline parallelism over wires | Not chosen |
| On-device learning | Model and data never leave the device | Possible future work |
| Pico as the "hands" of a local LLM | High demo charisma | Partially lives on in the optional base-station LLM |
| Bare-metal AI OS | OS passion | Scoped down to a runtime |
| **Mesh network of listening nodes** | Uses networking, embedded, local AI, low power | **Chosen** |

We settled on **audio detection + mesh networking + a low-power runtime**, applied to **search and rescue**. It has a real problem, a clear reason the AI has to be local, and uses nearly every skill on the team.

### 3. Classifier target: whistles, screams and "help"

**Decision:** Detect three alert classes: **whistle** (including the three-blast distress pattern), **scream**, and the spoken word **"help"**. The model also has two non-alert classes, **other_speech** and **background**, which absorb everything else. "Help" is a must-have for the demo, not a stretch goal.

**Why:**
- Hikers are taught to carry whistles; three blasts is a recognized distress signal. Whistles are acoustically distinct (narrow, high-frequency tones), so they're the easiest class for a tiny model.
- Not everyone carries a whistle. A lost or injured person yells, and "help" is the word they yell. A detector that only hears whistles misses them.
- "Help" is a single-keyword spotting problem, the same shape as TensorFlow Lite Micro's `micro_speech` example, so it fits on the Pico.
- An explicit **other_speech** class is what keeps "help" honest: without it, any talking near a node looks like "help". Hikers chatting on the trail must not raise alerts.
- This is still a narrow target: one whistle class, one scream class, one keyword. "Detect any human in distress" is not achievable in a weekend.

### 4. Networking: BLE flooding, not Wi-Fi soft APs

This was the biggest change during ideation. The original plan was to interlink nodes using Wi-Fi soft access points.

**Options considered:**

| | Wi-Fi + UDP (soft AP) | BLE advertisement flooding | Wired PIO links | LoRa (external module) |
|---|---|---|---|---|
| Payload | ~1,400 bytes | ~20–30 bytes | Flexible | Small |
| Topology | Star around the AP unless you build bridging | True peer-to-peer mesh | Point-to-point | Mesh possible |
| Single point of failure | Yes, the AP | No | Per link | No |
| Power | Highest | Low | Low | Low |
| Range per link | Tens of meters (similar to BLE) | Tens of meters | Cable length | Kilometers |
| Extra hardware | None | None | Wires | LoRa module per node |

**Decision:** **BLE advertisement flooding.**

**Why:**
- **Low power.** Keeping Wi-Fi access points running between nodes drains batteries quickly and contradicts the "low power" goal.
- **True mesh.** No AP means no central point of failure. Any node can die and the rest keep working.
- **Our messages are tiny.** An alert ("node 4 heard a whistle, 91%") easily fits in one advertisement. We don't need Wi-Fi bandwidth.
- **Chaining soft APs is fiddly.** Running AP and client at once on the Pico's Wi-Fi driver is uncertain territory for a weekend.
- **Range.** Per link, Wi-Fi and BLE are roughly the same (same 2.4 GHz band, same onboard antenna). Across the whole network, BLE mesh wins because every hop extends coverage, while a Wi-Fi star is limited to one circle around the AP.

**Production path:** real wilderness coverage needs kilometers, not tens of meters. The flooding logic carries over almost unchanged to a **LoRa** radio (as in Meshtastic). For the hackathon we use BLE; LoRa is the deployment upgrade.

### 5. Pico SDK, not bare metal

**Decision:** Build on the Pico SDK's own primitives (`async_context`, hardware alarms, `pico_multicore`, PIO and DMA helpers) instead of writing our own scheduler or sleep/wake layer. Our "runtime" is a thin layer of glue: the node state machine and radio duty cycling.

**Why:** We're building a demo, not a product. A custom scheduler and bare-metal power management compete for the same weekend as the mesh and the classifier, and they're invisible on stage. The SDK already gives us event scheduling, timers and wait-for-interrupt idling, and BTstack on the Pico already runs on `async_context` (we use it in poll mode via `pico_cyw43_arch_poll`), so we work with it rather than around it. The interesting systems work goes into the mesh and on-device inference.

### 6. Keep the Pico SDK's radio driver

**Decision:** Use the SDK's CYW43 driver and Bluetooth stack rather than writing our own.

**Why:** Rewriting the wireless chip driver would consume the entire weekend for no visible gain. Our custom work goes into the mesh layer and the classifier.

**Status: decided.** We use the SDK's `pico_cyw43_driver` and BTstack, and the firmware builds on the Pico SDK. The driver can't be lifted out on its own, because `cyw43-driver` depends on other SDK pieces: PIO (the SPI bus to the CYW43439), DMA, interrupts, timers and `async_context`. Writing our own driver was never realistic. The CYW43439 runs a closed Infineon firmware that the driver uploads at every boot, and the host side would also need a full Bluetooth stack.

### 7. Listen cheaply, classify rarely

**Decision:** A cheap always-on wake trigger (loudness / frequency-band energy) gates the classifier.

**Why:** Running the model continuously wastes power. The trigger costs almost nothing; the classifier only runs when there's something worth checking. This also gives the runtime's power management a concrete job.

### 8. Raspberry Pi 5 as the base station

**Decision:** The Pi 5 is the base station (and the fourth node), instead of a Pico tethered to a laptop.

**Why:**
- It has **built-in Bluetooth LE**, so it can listen to the mesh directly.
- It can **host the dashboard** on its own local Wi-Fi. Judges or rescuers open it on a phone, no internet needed.
- It matches a realistic deployment: **one powered hub** at a ranger station or trailhead, **many low-power nodes** on batteries in the field.

### 9. Localization by loudest node

**Decision:** Estimate location by which node(s) heard the call, weighted by loudness in dB. Each node's gain is calibrated once in the demo room so levels are comparable across nodes. Alert timestamps stay as node uptime; no mesh time sync.

**Why:**
- It's simple, needs no time synchronization, and makes for a clear map.
- Loudness is only comparable across nodes if the nodes agree on what "loud" means, hence the one-time calibration (see [peak level](#peak-level-and-calibration)).
- Synced mesh time doesn't pay for itself here. Sound travels about 34 cm per millisecond, and every BLE hop adds a random advertising delay of several milliseconds, so time sync over the mesh can't get anywhere near the sub-millisecond accuracy that time-difference-of-arrival needs. To group "the same event heard by several nodes", the base station clusters alerts that arrive within a short window (about 2 seconds), which is plenty at demo scale.
- More precise localization (TDOA with GPS or wired time sync) is future work.

### 10. INMP441 microphone over PIO I2S

**Decision:** Use the INMP441 I2S MEMS mic, read through a PIO I2S program feeding DMA, with the mic's L/R pin tied to GND.

**Why:** The INMP441 is cheap, digital (no analog front end to tune), and has a tight sensitivity spec, which makes cross-node calibration easy. The RP2350 has no I2S peripheral, but PIO handles I2S cleanly, and DMA lets samples stream into memory without the CPU. Tying L/R to GND puts the mic on the left channel, so we keep the left slot and drop the right.

### 11. Arm build only

**Decision:** Build the `pico2_w` target for the Arm Cortex-M33 cores. RISC-V (Hazard3) moves to future work.

**Why:** The M33 has a hardware FPU and DSP instructions, which audio feature extraction and TensorFlow Lite Micro can use. It's also the most-tested path for the SDK's BLE stack. A RISC-V build was a side experiment, and the demo doesn't need it. See [docs/cpu-architecture.md](docs/cpu-architecture.md).

---

## Mesh protocol (Serranet)

### Flooding rules

A node that receives a packet:

1. Checks the `magic` byte; ignores anything that isn't ours.
2. Looks up `(src, msg_id)` in a small **recently-seen cache**. If seen, drop it.
3. Records it as seen, and delivers it locally if relevant.
4. If `ttl > 0`: decrements `ttl`, waits a **random jitter** (a few ms, so neighbors don't collide), then re-broadcasts.

Relays forward `src` and `msg_id` unchanged, so every copy of an alert carries the same `(src, msg_id)` pair no matter which path it took. That pair is what lets nodes and the base station drop repeats.

### Node IDs and sequence numbers

- **`src` (node ID):** derived from each board's unique flash ID, so no manual configuration is needed.
- **`msg_id` (sequence number):** the originating node increments it for every packet it sends. It's **seeded randomly at boot** (e.g. `get_rand_32()`), not from 0. Otherwise a node that reboots mid-demo would reuse IDs its neighbors still have cached, and its first alerts after the reboot would be silently dropped as duplicates.
- **Cache expiry:** recently-seen entries expire after about 60 seconds, as a second guard against the same problem.

### Packet format (proposed)

```c
typedef struct __attribute__((packed)) {
    uint8_t  magic;      // identifies Serranet packets
    uint16_t src;        // origin node ID
    uint16_t dst;        // 0xFFFF = broadcast
    uint16_t msg_id;     // per-origin sequence number, random seed at boot; (src, msg_id) = dedup key
    uint8_t  ttl;        // hops remaining
    uint8_t  type;       // ALERT, HEARTBEAT, ...
    uint8_t  payload[];  // type-specific
} mesh_pkt_t;            // 9-byte header
```

### Payload budget

A legacy BLE advertisement is 31 bytes. After the flags field and manufacturer-specific data header (we'll use the testing company ID `0xFFFF` for the hackathon), roughly **24 bytes** remain. With a 9-byte header that leaves **~15 bytes of payload**, plenty for an alert:

```c
typedef enum {
    CLASS_WHISTLE = 1,
    CLASS_SCREAM  = 2,
    CLASS_HELP    = 3,     // the spoken word "help"
} alert_class_t;           // other_speech / background never produce alerts

typedef struct __attribute__((packed)) {
    uint8_t  class_id;     // alert_class_t: WHISTLE, SCREAM or HELP
    uint8_t  confidence;   // 0–255
    int16_t  peak_level;   // calibrated peak level, tenths of a dB (e.g. 853 = 85.3 dB)
    uint32_t timestamp;    // origin node uptime in ms (not synced across nodes)
    uint8_t  blast_count;  // whistles only (e.g. 3 = distress pattern); 0 for SCREAM and HELP
} alert_payload_t;         // 9 bytes

static_assert(sizeof(alert_payload_t) == 9, "alert payload is 9 bytes");
```

### Peak level and calibration

`peak_level` is the loudest moment of the detected sound, in dB. On the node it's computed as dBFS (`20·log10(peak / full_scale)`, always ≤ 0) plus a per-node calibration offset, then sent in tenths of a dB. The offset is chosen so the reference tone reads the same agreed value on every node (e.g. 80.0 dB), which is why sent values are positive.

**Calibrate once, in the demo room:** put each node at the same distance from a phone playing a steady reference tone at a fixed volume, read the node's dBFS, and store the offset that brings all nodes to the same value (in flash, or a `#define` per board for the demo). The INMP441's sensitivity is specified to ±1 dB, so this mostly evens out placement, enclosures and wiring rather than mic-to-mic variation. Absolute dB SPL isn't needed; nodes only have to agree with each other.

### Message types (proposed)

- `ALERT`: a detection.
- `HEARTBEAT`: periodic "I'm alive", so the dashboard can show which nodes are online. Stretch goal.

---

## Low-power runtime

Our "OS" is a small runtime sitting on top of the Pico SDK. The SDK provides drivers; the runtime decides when things run and when the chip and radio sleep.

**SDK building blocks:**
- **Radio and BLE:** `pico_cyw43_arch_poll` + `pico_btstack_ble` + `pico_btstack_cyw43` (as in `firmware/CMakeLists.txt`). Radio and BTstack work happens when core 0's main loop calls `cyw43_arch_poll()`; under the hood that's the SDK's `async_context` in poll mode.
- **Scheduling:** the core 0 main loop plus the SDK alarm pool (`add_alarm_in_ms`, repeating timers) for scan windows, heartbeat and relay jitter. No custom task scheduler.
- **Dual core:** `pico_multicore`. Core 0 runs the radio and mesh; core 1 runs audio, the wake trigger and the classifier. They pass detections over the SDK's inter-core FIFO or a `queue_t`.
- **Audio input:** a PIO I2S program plus DMA streams INMP441 samples into a ring buffer, so the CPU only wakes when a block is ready.
- **Idling:** cores wait on interrupts (`__wfi()` / the SDK's blocking waits) instead of busy-waiting.

Deep sleep (dormant mode, via pico-extras' `pico_sleep`) is out of scope for the demo: a node in dormant mode can't scan BLE, so it can't relay. Power numbers come from radio duty cycling and the listen-cheaply / classify-rarely split.

**Node states:**

| State | What's running | Wakes on |
|---|---|---|
| `LISTEN` | Mic + cheap wake trigger, periodic BLE scan windows | Sound above threshold, scan window timer |
| `CLASSIFY` | Classifier inference | Inference done |
| `TRANSMIT` | BLE advertising of an alert or relay | Advertising done |
| `IDLE` | Cores in wait-for-interrupt between scan windows and audio blocks | Timer, DMA interrupt |

---

## Audio classifier pipeline

### Classes

One model, five output classes. Only the first three raise alerts.

| Class | Alerts? | `class_id` | Training data |
|---|---|---|---|
| `whistle` | Yes | `WHISTLE` | Our own recordings: several whistles, single blasts and three-blast patterns, different distances |
| `scream` | Yes | `SCREAM` | Volunteers screaming in the demo room (with consent), plus a dataset if we find one with a usable license (**open**) |
| `help` | Yes | `HELP` | "help" clips from the [Multilingual Spoken Words Corpus](https://mlcommons.org/datasets/multilingual-spoken-words/) (MLCommons, CC-BY 4.0) **plus** in-room takes from our volunteer (PC mic, then the INMP441) |
| `other_speech` | No | n/a | Other words from the Spoken Words Corpus, plus the volunteer talking normally. Teaches the model that speech is not "help" |
| `background` | No | n/a | Silence, wind, birds, footsteps, music, a noisy room |

The in-room volunteer takes matter: the corpus clips are mostly read speech recorded on laptop and phone mics, while the demo is somebody shouting "help!" across a room at an INMP441. A few dozen takes (different distances, volumes and directions) close most of that gap. Hold some takes back for testing.

### Pipeline

1. **Collect data.** Per the table above. We record on PC mics to get a first model working, then add a top-up set through the **INMP441** itself, since the mic shapes the signal. Get consent before recording anyone.
2. **Extract features.** 16 kHz mono audio, 1-second windows → TFLM's audio microfrontend (30 ms frames every 20 ms, 40 filterbank channels → 49 × 40), the `micro_speech` recipe. The same C code runs on the Pico, so training and device features match. It covers the whistle band (roughly 2–4 kHz) as well as speech.
3. **Train.** A small CNN in Python (managed with `uv`).
4. **Quantize.** int8, to fit and run fast on the Pico.
5. **Deploy.** Via TensorFlow Lite Micro on the Arm build, using CMSIS-NN optimized kernels where the Pico port supports them.
6. **Pattern logic.** Count whistle detections over time to fill in `blast_count` (3 = distress pattern). Screams and "help" alert on a single confident detection, with `blast_count = 0`.
7. **Thresholds.** Tune per-class confidence thresholds on held-out data, biased toward catching "help" (a missed call is worse than a false alarm), and check that ordinary talking stays under the threshold.

### Mic input

The INMP441 sends 24-bit samples MSB-first inside 32-bit I2S slots. With L/R tied to GND it drives the **left** slot, and the right slot is empty.
- A PIO program generates the bit clock (SCK) and word select (WS) and shifts in the data line (SD). At 16 kHz with 32-bit slots, SCK = 64 × 16 kHz = 1.024 MHz.
- DMA moves the 32-bit words into a ring buffer; we keep the left slot and discard the right.
- Each sample is converted with an **arithmetic** right shift: `int32_t s = ((int32_t)word) >> 8;`, giving a signed 24-bit value. Keep it signed: a logical shift would turn negative samples into large positive ones.

---

## Base station

Runs on the Raspberry Pi 5.

- **Start listen-only.** Scan for BLE advertisements and decode Serranet packets (Python + `bleak`).
- **Same packet format** as the Picos, including **dedup by `(src, msg_id)`**, since the same alert arrives via several paths.
- **Group events.** Alerts of the same class from different nodes that arrive within about 2 seconds of each other are treated as one event heard by several nodes. Node timestamps are uptime and aren't compared across nodes.
- **Dashboard.** A web page served by the Pi, showing a map of node positions. Nodes light up when they report a detection, labeled whistle / scream / help; the loudest (calibrated dB) is highlighted as the likely location.
- **Local network.** The Pi hosts its own Wi-Fi so anyone nearby can open the dashboard on a phone without internet.
- **Optional:** a small local model on the Pi turns raw alerts into plain language, e.g. *"Repeated distress whistle near node 3, 12:41, likely 3 blasts."* or *"Someone shouted 'help' near node 2, 12:43."*

---

## Demo

1. Spread the nodes around the room and place them on the dashboard map.
2. **Turn transmit power down** so nodes on the same table can't all hear each other. This forces multi-hop routing so the mesh visibly does its job.
3. Calibrate each node's gain once with the reference tone (see [peak level](#peak-level-and-calibration)).
4. Someone blows a whistle near the farthest node. Then someone shouts "help!" near another node, and someone screams near a third.
5. Each node lights up on the map with its class (whistle / scream / help), the alert hops across the mesh, and the dashboard shows the hop path and the estimated location.
6. Have people chat normally next to a node: nothing should light up.

**Numbers for the slides:** model size, inference time, energy per inference, hop count, end-to-end alert latency, estimated battery life.

---

## Known limitations and open questions

- **Range.** The onboard antenna gives tens of meters per hop. Real terrain needs many nodes or LoRa.
- **Scan duty cycle vs. power.** Continuous BLE scanning is power-hungry, but nodes must listen to relay. Duty-cycled scanning saves power at the cost of relay latency and missed packets. Tuning this is an open design question.
- **No delivery guarantee.** Flooding is best-effort; repeated alerts and multiple paths provide redundancy, but there are no acks.
- **Airtime.** Every node repeats every message. This is fine for a handful of nodes and rare alerts, but doesn't scale to heavy traffic.
- **False positives.** Birds and other high-pitched sounds may resemble whistles; the three-blast pattern logic helps. Ordinary talking could trigger "help"; the `other_speech` class and threshold tuning are the guard.
- **"Help" is English-only** and tuned to the voices we trained on. The volunteer takes help in the room, but other voices, accents and languages will be weaker.
- **Scream data.** We don't yet have a scream dataset with a clear license; for now it's in-room recordings.
- **Localization is coarse.** "Which node heard it loudest" gives an area, not a point, and it relies on the one-time gain calibration.
- **Time sync.** Timestamps are per-node uptime, not synced. The base station groups alerts by arrival time instead (see [decision 9](#9-localization-by-loudest-node)).

---

## Future work

- **LoRa radios** for kilometer-scale coverage.
- **Smarter routing,** e.g. a simplified distance-vector scheme, with live route tables on the dashboard.
- **Two-way messaging,** so the base station can send acknowledgements or commands back into the mesh.
- **More sound classes:** SOS taps, more keywords and languages ("ayuda", "au secours", ...).
- **Better localization** using time-difference-of-arrival, with clocks synced by GPS or a wire rather than over BLE.
- **A RISC-V build** with hand-tuned inference kernels on the RP2350's Hazard3 cores, plus Arm vs. RISC-V energy comparisons (see [docs/cpu-architecture.md](docs/cpu-architecture.md)).
- **Deep sleep** between scan windows (dormant mode), once relaying can tolerate it.
- **On-device learning** so nodes can adapt to local background noise.
- **Gossip learning** to share model improvements across the mesh.
- **Hardened enclosures** and solar power for real deployments.

---

## Repository layout (proposed)

```
serra/
├── firmware/                # Pico 2 W node (C, Pico SDK 2.3.1), see firmware/README.md
│   ├── runtime/             # scheduler, sleep/wake, power budgets
│   ├── audio/               # mic capture (PIO/I2S), wake trigger
│   ├── classifier/          # int8 model + inference
│   ├── mesh/                # BLE advertise/scan, flooding, dedup
│   ├── main.c
│   ├── CMakeLists.txt       # SDK build -> build/node.uf2
│   ├── pico_sdk_import.cmake  # locates the SDK via $PICO_SDK_PATH
│   ├── flashing_pico.md     # flashing with picotool, tips
│   └── README.md
├── model/                   # training pipeline (Python, uv)
│   ├── data/                # recordings (large files not committed)
│   └── train.py
├── serra_brand/         # Serra brand kit: logos (SVG/PNG), brand PDF, colors, type
├── base-station/            # Pi 5: BLE listener + dashboard
├── scripts/
│   ├── install-firmware-tooling.sh  # toolchain + Pico SDK setup (macOS, apt Linux)
│   └── pico_setup.sh        # Raspberry Pi's full SDK/OpenOCD setup on the Pi 5
├── docs/
│   ├── classifier-interface.md  # model -> firmware handoff: mic, runtime, C API, budgets
│   ├── cpu-architecture.md  # RISC-V vs. Arm analysis
│   ├── radio-range-options.md  # BLE vs. other radios for node-to-node range
│   ├── rp2350-memory-map.md # RP2350 address map and peripheral base addresses
│   ├── refs/firmware/       # Pico 2 W / RP2350 datasheets, pinout, schematic, guides
│   └── reports/firmware/    # hardware test reports, one per session (YYYY-MM-DD-topic.md)
├── .vscode/                 # recommended editor extensions
├── .clang-format
├── .clangd                  # clangd config: arm-none-eabi-gcc, Cortex-M33 flags
├── .editorconfig
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## Brand

The Serra brand kit lives in [`serra_brand/`](serra_brand/): logos for Serra, Serranet and Serranode (SVG for app and web, PNG otherwise), the brand PDF, colors and type. See [`serra_brand/README.md`](serra_brand/README.md) for usage.

---

## License

Licensed under the **GNU General Public License v3.0**. See [LICENSE](LICENSE). GPL-3.0 keeps derivatives open, which fits the project's local-first, sovereignty ethos.

Notes:
- The Pico SDK is BSD-3-Clause.
- The CYW43 driver (`lib/cyw43-driver/LICENSE.RP`) and BTstack (`src/rp2_common/pico_btstack/LICENSE.RP`, both in the SDK) are licensed only for use with Raspberry Pi hardware. BTstack's grant covers the Pico 2 W and products built from it. Check both before any commercial use. Those terms add restrictions GPL-3.0 doesn't allow, so redistributing node firmware binaries may need a GPL linking exception for them. This is an open question, not settled.
- Check the license of any dataset used for training.
