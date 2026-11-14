# 2026-11-14: Mic and classifier on three mesh nodes

First run of the full detection path on node firmware: INMP441 mic → features and int8 model on core 1 → `ipc` hand-off → core 0 → BLE alert → decoded on the other nodes. Three Pico 2 Ws, each with its own mic, on one desk.

## Setup

| | |
|---|---|
| Boards | 3 × Raspberry Pi Pico 2 W, each with an INMP441 (JESSINIE breakout) |
| Mic wiring | SD → GP2, SCK → GP3, WS → GP4, L/R → GND, VDD → 3V3(OUT) (pin 36), GND → GND ([`docs/classifier-interface.md`](../../classifier-interface.md)) |
| Firmware | `feat/audio` at `390e8fc` (before rebasing onto `main` with PR #5 merged) (`feat(firmware): run the mic and classifier on core 1`): `main` + `runtime/ipc` (`a6d8c47`) + a local merge of PR #5 (`feat/classifier-on-pico` at `1fa9d9b`: mic driver, features, int8 model, TFLM wrapper). Same `node.uf2` on all three |
| Not included | PR #6 (mesh dedup, tx queue, relaying). Each node advertises its latest alert until the next one replaces it, and prints every copy it hears |
| Build | Pico SDK 2.3.1, `arm-none-eabi-gcc` 14.2.1, `pico-tflmicro` at `dfea53b`, `PICO_BOARD=pico2_w`, `SERRA_TEST_BEACON=0` (no fake alerts). Text 529,680 B, bss 96,180 B |
| Classifier settings | `classifier_init(0)`: no calibration offset, so `peak_level` is uncalibrated |
| Host | Windows + WSL2, drag-and-drop flashing, PuTTY on USB serial |

Node IDs and radio tags are derived from each board's unique ID and BLE address, so they are replaced with placeholders. The placeholders match the [dedup/relay report](2026-11-14-mesh-dedup-relay.md): `NODE_1`, `NODE_2` (board A there) and `NODE_3`.

## Raw output

Boot, every board:

```
[mesh] node NODE_3
[main] main loop running
[ble] up, addr xx:xx:xx:xx:xx:xx, scanning
[listen] mic + classifier running on core 1
```

Detections reported by the node that heard them (core 1, then core 0's hand-off line):

```
[listen] detected class=2 conf=248 peak=-154 blasts=0          NODE_3
[ipc] alert class=2 conf=248 peak=-154 blasts=0 ts=9099
[listen] detected class=2 conf=220 peak=-293 blasts=0          NODE_3
[ipc] alert class=2 conf=220 peak=-293 blasts=0 ts=18702
[listen] detected class=1 conf=210 peak=-256 blasts=3          NODE_1
[ipc] alert class=1 conf=210 peak=-256 blasts=3 ts=8141
```

The same alerts received over BLE on another node (one line of the many repeats each):

```
[mesh] rx src=NODE_3 msg_id=64691 ttl=4 type=1 rssi=-35 class=2 conf=220 peak=-293 ts=18702
[mesh] rx src=NODE_1 msg_id=6336 ttl=4 type=1 rssi=-21 class=1 conf=210 peak=-256 ts=8141
[mesh] rx src=NODE_1 msg_id=6344 ttl=4 type=1 rssi=-31 class=3 conf=255 peak=-371 ts=302863
[mesh] rx src=NODE_3 msg_id=38779 ttl=4 type=1 rssi=-40 class=1 conf=214 peak=45 ts=395371
[mesh] rx src=NODE_2 msg_id=11029 ttl=4 type=1 rssi=-52 class=1 conf=255 peak=-325 ts=22475
[mesh] rx src=NODE_1 msg_id=42248 ttl=4 type=1 rssi=-24 class=1 conf=255 peak=-205 ts=34262
```

## Summary

| Node | Classes it reported | Received on another node |
|---|---|---|
| `NODE_1` | whistle (once with `blasts=3`), "help" | yes |
| `NODE_2` | whistle | yes, on both others |
| `NODE_3` | scream, whistle | yes |

## What this shows

- **The full detection path works on node firmware.** Each node's mic, features and model ran on core 1, and every detection crossed to core 0 (`[ipc] alert`) and went out over BLE. Fields match exactly between the detecting node and the receiving node (class, confidence, peak level, timestamp).
- **All three classes came out of the classifier on a node:** whistle (`class=1`), scream (`class=2`), "help" (`class=3`). One whistle was reported with `blasts=3`, the distress pattern.
- **The radio and the classifier run side by side.** Core 0 kept receiving other nodes' packets before, during and after inferences on core 1.
- **All three mics work**, after one module was fixed (see Findings).
- High confidences: several detections at `conf=255`.

## What it does not show

- **Accuracy.** Which sound was made each time wasn't logged, so the classes above are what the classifier reported, not checked against ground truth. No count of missed sounds or false alerts.
- **Relaying of real detections.** This build has no relaying, dedup or packet expiry (PR #6); every alert was received directly (`ttl=4`).
- **Latency, power, range, calibrated levels.** `peak_level` is uncalibrated (offset 0).
- **Long runs.** Each session ran for minutes, not hours.

## Findings

- **One mic module ignores WS and sends a raw bitstream.** One board booted normally (`[listen] mic + classifier running on core 1`) but stopped detecting. Swapping mic modules between two boards moved the fault to the other board, so the fault was in the module. Later diagnosis showed the module ignores WS and outputs its one-bit converter stream on SD instead of I2S samples. It sometimes still produced detections during this run (`NODE_3`'s whistle at `peak=45` came from it), which made it look like a loose connection at first. `mic.c` now detects a bitstream mic at boot and filters the stream to normal 16 kHz samples (`cb50082`, PR #5), so the same firmware runs on every node; not yet re-tested with that module on a node.
- **A loose connection on another node.** `NODE_2`'s mic cut out intermittently and came back after reseating. For the demo: check every mic connection (solder joints on the loose headers, dupont wires) and test each node with a whistle after assembly.
- **Positive peak levels with loud, close sounds.** `peak=34` (+3.4) and `peak=45` (+4.5) were reported for loud sounds close to the mic, with no calibration offset. dBFS can't exceed 0, so either the mic was clipping or `peak_level` uses a different reference. Doesn't affect detection; matters for calibration and the "loudest node" location estimate. Open question for the classifier side.
- **Endless repeats without PR #6.** A node keeps advertising its last alert until the next one, and receivers print every copy, so one alert scrolls forever on the other nodes' serial. Expected on this build; PR #6's 5 s expiry and dedup fix it.
- **Mic VDD must be on pin 36, 3V3(OUT).** The neighbors are easy to mix up: pin 37 (3V3_EN) is the regulator's enable input, not a supply, and pins 39/40 carry ~5 V, above the INMP441's 3.63 V maximum.
