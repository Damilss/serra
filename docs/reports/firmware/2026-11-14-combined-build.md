# 2026-11-14: Combined build (mic + classifier + mesh) on three nodes

First run of the build that has everything together: the mic and classifier on core 1, calibration, and PR #6's dedup, tx queue and relaying on core 0. Short session: checks that the nodes still talk once the mesh code and the audio code share one image.

## Setup

| | |
|---|---|
| Boards | The three demo nodes with mics (`NODE_1`, `NODE_2`, `NODE_3`, same placeholders as the [mic](2026-11-14-mic-classifier-nodes.md) and [calibration](2026-11-14-calibration.md) reports) |
| Firmware | `feat/audio` at `c12eee7` (`refactor(firmware): drop the console's fake-alert beacon`), rebased on `main` at `297ef28` (PRs #5, #6, #7 merged). Normal build: no debug lines, `SERRA_TXQ_DEBUG` and `SERRA_LISTEN_DEBUG` off |
| Build | Pico SDK 2.3.1, `arm-none-eabi-gcc` 14.2.1, `pico-tflmicro` `dfea53b`. Text 535,852 B, bss 126,776 B |
| Host | Windows + WSL2, PuTTY on two nodes |

## What changed compared to the earlier sessions

- Nodes no longer send anything on a timer. The console's 5 s fake-alert beacon is gone; a node sends only real detections, relays, and a test alert when someone types `a`.
- Each alert prints once on the other nodes (dedup) and leaves the air after 5 s (tx queue), instead of being re-advertised and reprinted forever.

At first this looked like "the nodes aren't talking": with no sound in the room, a working network is now silent.

## Raw output

`a` typed twice on `NODE_3`:

```
a
[test] test alert queued, node NODE_3 ts=232695
a
[test] test alert queued, node NODE_3 ts=233699
```

Another node:

```
[mesh] rx src=NODE_3 msg_id=10463 ttl=4 via=TAG_3 rssi=-26 dups=632 class=1 conf=200 peak=853 ts=232695
[mesh] relay ttl=3 in 17 ms (relays=22)
[mesh] rx src=NODE_3 msg_id=10464 ttl=4 via=TAG_3 rssi=-27 dups=645 class=1 conf=200 peak=853 ts=233699
[mesh] relay ttl=3 in 45 ms (relays=23)
```

## What this shows

- **The combined image runs and the mesh works in it.** Both test alerts arrived once each, directly from `NODE_3`, and were relayed once with `ttl - 1` inside the 10–50 ms jitter.
- **Dedup works with the audio code in the same image.** `dups` rose by 13 between the two alerts: the repeat copies were heard and dropped instead of printed.
- **Core 1 doesn't get in the way of core 0's radio work** with the mic and classifier running.

## What it does not show yet

- **A real detection through the mesh in this build** (whistle → `[listen] detected` → one `rx` line per other node). Detections and relaying were each shown in earlier sessions, but not together in one image.
- **A two-hop real detection** (`b <tag>` on the receiver, whistle at the origin, arrival with `ttl=3`).
- **The calibrated location check:** the node nearest a sound reporting the highest `peak_level`.
- **The base station** (`base-station/`, PR #7) receiving any of this.
