# 2026-11-14: Peak-level calibration of the three demo nodes

Reference-tone calibration so every node reports the same `peak_level` for the same sound, per the README's [Peak level and calibration](../../../README.md#peak-level-and-calibration). Without it, the "loudest node" location estimate compares mics rather than distances.

## Setup

| | |
|---|---|
| Boards | The three demo nodes, `NODE_1`, `NODE_2`, `NODE_3` (same placeholders as the [mic report](2026-11-14-mic-classifier-nodes.md)): two INMP441s on I2S, one module that sends a raw bitstream (filtered to samples by `mic.c`) |
| Firmware | `feat/audio` at `959c890` (per-node calibration table, all offsets 0), built with `-DSERRA_LISTEN_DEBUG=ON` in `firmware/build_calib`. The debug line prints, once a second, the largest raw sample (`raw_peak`) and the classifier's level of its latest 240 ms window (`level`, tenths of a dB, offset 0 = dBFS) |
| Reference | 1 kHz tone from a phone tone app, fixed volume, speaker aimed at the mic, held at a fixed distance from each node in turn. Distance itself doesn't matter, only that it's the same for every node |
| Target | Each node's offset is chosen so the tone reads 80.0 dB (`LISTEN_CALIB_TARGET_DB_X10 = 800`): `offset = 800 - level` |

Node IDs are derived from each board's unique ID, so they are replaced with placeholders here; the real IDs are in `calib_table` in `firmware/audio/listen.c`, where the firmware needs them.

## Raw readings (`level`, tenths of a dB)

| Node | Mic | Readings | Dropped |
|---|---|---|---|
| `NODE_1` | I2S | -618, -622, -623, -630, -609, -613, -613, -589, -608, -623, -628, -611, -641, -652, -654, -627, -637, -646, -647, -620, -620 | -517 (`raw_peak` doubled: a bump, not the tone) |
| `NODE_2` | I2S | -566, -574, -558, -562, -570, -569, -569, -565 | none |
| `NODE_3` | bitstream | run 1: -590, -521, -585, -603. Run 2: -521, -533, -528, -553 | -445 (run 2, `raw_peak` 53098: a bump) |

## Result

| Node | Median | Spread | Offset |
|---|---|---|---|
| `NODE_1` | -62.3 dB | ~6 dB (a dip to about -65 mid-run, where the classifier also stopped running the model: the tone dropped or the phone moved) | **+142.3** |
| `NODE_2` | -56.7 dB | 1.6 dB | **+136.7** |
| `NODE_3` | -54.5 dB (both runs together) | ~8 dB; the two runs' medians differ by 6 dB | **+135.5** |

Committed as `aefb1d9` (`feat(firmware): calibrate the three demo nodes' peak levels`).

## What this shows

- **The mics agree within about 8 dB before calibration.** The bitstream module is not tens of dB hotter, as positive peak levels earlier in the day suggested; those were loud sounds close to the mic.
- **The I2S path is steady** for a steady tone (`NODE_2`: 1.6 dB spread). `raw_peak` moves a lot between seconds even then (14k to 26k), so it's a wiring check, not a level reading; `level` is the number to use.
- **The bitstream node is noisier** (~8 dB within a run, 6 dB between runs) with the same setup, so its offset is the least certain.
- Overall the offsets are good to about ±3 dB, which suits the coarse loudness-weighted location (doubling the distance to a sound changes its level by about 6 dB).

## What it does not show

- **That the calibrated nodes rank distance correctly.** Not checked yet: whistle next to each node and confirm it reports the highest `peak_level`.
- **The demo room.** Measured at the desk; reflections and placement in the demo room can shift each node by a few dB.
- **Loud sounds.** One moderate tone level only; whether the bitstream path stays linear (and doesn't clip) for shouts near the mic is untested.

## Next time

Measure all three nodes in one sitting with the phone fixed in place (resting on something, not hand-held), each node brought to the same marked spot, and go round twice (`1, 2, 3, 1, 2, 3`) so slow drift in the phone or the room cancels out.
