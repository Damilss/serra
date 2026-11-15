# 2026-11-14: Mesh dedup, tx queue and relaying on two and three Pico 2 Ws

First hardware run of the mesh layer on `feat/mesh-dedup`: the seen cache (dedup), the tx queue that shares the single advertising slot, and relaying. Two boards first, then a third board for a forced two-hop path ([Three boards](#three-boards-forced-hop)). All boards side by side on a desk.

## Setup

| | |
|---|---|
| Boards | 2, later 3 × Raspberry Pi Pico 2 W, no mic attached |
| Firmware | `feat/mesh-dedup` at `8f3f680` (`feat(firmware): relay mesh packets and add a serial test console`), same `node.uf2` on all boards. That commit still ran on `runtime/scheduler.c`; the branch was later rebased onto the `async_context` port as `eec71ea` with the same mesh logic and re-tested the same day (see [Re-test on the async_context build](#re-test-on-the-async_context-build)) |
| Build | Pico SDK 2.3.1, `arm-none-eabi-gcc` 14.2.1 (14.2.rel1), `PICO_BOARD=pico2_w`, `TXQ_DEBUG=1` |
| Host | Windows + WSL2; flashed by drag-and-drop onto the `RP2350` drive; serial over USB CDC in PuTTY (115200, which USB CDC ignores) |
| Power | Board 1: laptop USB, serial monitor attached. Board 2: USB power bank, no serial |
| Distance | About 20 cm, line of sight |
| Firmware settings | Advertising every 100 ms; passive scan, 50 ms window every 100 ms; queue turns of 300 ms; alerts and relays live 5 s; test beacon every 5 s; `MESH_TTL_DEFAULT` 4 |

Node IDs and radio tags are derived from each board's unique ID and BLE address, so they are replaced below with `NODE_1`..`NODE_3` and `TAG_1`..`TAG_3` (see CONTRIBUTING, `docs/reports/`). The same board keeps the same placeholder throughout. The `msg_id` values are random per boot and are left as logged.

## Commands

```bash
git checkout feat/mesh-dedup
cmake --build firmware/build                 # -> firmware/build/node.uf2
explorer.exe "$(wslpath -w firmware/build)"  # drag node.uf2 onto the RP2350 drive, both boards
```

Serial: PuTTY on board 1's COM port.

## Raw output

Board 1 alone (board 2's power bank had switched itself off, see [Findings](#findings)):

```
[mesh] node NODE_1
commands: a = send alert | b <tag> = block radio | u = unblock all |
          p = pause/resume beacon | s = status | h = help
[main] scheduler running
[test] beacon alert queued, node NODE_1 ts=1479
[txq] on air slot 0 msg_id=20560
[ble] up, addr 2C:CF:67:xx:xx:xx (tag TAG_1), scanning
[test] beacon alert queued, node NODE_1 ts=6478
[txq] expired slot 0 msg_id=20560
[txq] on air slot 1 msg_id=20561
[test] beacon alert queued, node NODE_1 ts=11478
[txq] expired slot 1 msg_id=20561
[txq] on air slot 0 msg_id=20562
```

Board 1 with board 2 running again (excerpt):

```
[txq] on air slot 1 msg_id=20585
[txq] on air slot 0 msg_id=61681
[txq] expired slot 0 msg_id=61681
[txq] on air slot 1 msg_id=20585
[mesh] rx src=NODE_2 msg_id=61682 ttl=4 via=TAG_2 rssi=-39 dups=25 class=1 conf=200 peak=853 ts=13872
[mesh] relay ttl=3 in 44 ms (relays=3)
[txq] on air slot 0 msg_id=61682
[txq] on air slot 1 msg_id=20585
[txq] on air slot 0 msg_id=61682
[test] beacon alert queued, node NODE_1 ts=131478
[txq] expired slot 1 msg_id=20585
[txq] on air slot 0 msg_id=61682
[txq] on air slot 2 msg_id=20586
[txq] on air slot 0 msg_id=61682
[txq] on air slot 2 msg_id=20586
[mesh] rx src=NODE_2 msg_id=61683 ttl=4 via=TAG_2 rssi=-35 dups=38 class=1 conf=200 peak=853 ts=18872
[mesh] relay ttl=3 in 28 ms (relays=4)
[txq] on air slot 1 msg_id=61683
[txq] on air slot 2 msg_id=20586
[txq] expired slot 0 msg_id=61682
[txq] on air slot 1 msg_id=61683
[txq] on air slot 2 msg_id=20586
[test] beacon alert queued, node NODE_1 ts=136478
[txq] expired slot 2 msg_id=20586
[txq] on air slot 0 msg_id=20587
[txq] on air slot 1 msg_id=61683
```

## What this shows

- **Dedup works.** Each of board 2's alerts prints once (`61682`, then `61683`). Between them `dups` rises from 25 to 38: about 13 further copies of one alert were heard and dropped. That fits 5 s of re-advertising at 100 ms heard through a 50% scan window, minus the time the packet shares the air.
- **Relaying works for one hop.** Each new alert is relayed once, with `ttl` 4 → 3 and a jitter inside 10–50 ms (44 ms, 28 ms).
- **The tx queue shares the advertising slot.** Board 1's own alert and its relay of board 2's alert take 300 ms turns (slot 0 / slot 2, then slot 1 / slot 2) instead of overwriting each other, and each packet expires about 5 s after it was queued.
- **Own echoes are dropped.** Board 2 runs the same firmware and relays board 1's alerts back, yet no `rx` line ever shows `src=NODE_1`.
- **Reboot is handled.** Board 2 lost power and restarted (`ts` back near 13 s). Its new `msg_id`s (61681 and up) come from a fresh random seed, so board 1 did not drop them as stale duplicates.
- Board 2's timestamps step by 5000 ms, confirming it runs the 5 s beacon, so both boards ran this build.

## What it does not show

- **Multi-hop** in the two-board run: every node hears every other directly. See [Three boards](#three-boards-forced-hop) for the hop.
- **Board 2's side.** Board 2 had no serial monitor, so its relays of board 1's alerts are inferred from board 1 ignoring them, not seen directly. nRF Connect on a phone would show them.
- **Load.** One beacon every 5 s per node is far below the 8-slot queue's limit; eviction never happened.
- **Range, power and delivery rate.** Boards were 20 cm apart; no current measurements; missed alerts were not counted.
- **The async_context port** in the runs above, which used `runtime/scheduler.c`. See the re-test below.

## Three boards: forced hop

A third board was added. All three on one desk hear each other, so the console's block list forced the path: C ignores everything transmitted by A's radio, so A's alerts can only reach C through B.

| Role | Board | Node | Radio tag | Serial |
|---|---|---|---|---|
| A, origin | board 2 from above | `NODE_2` | `TAG_2` | none (power bank) |
| B, relay | board 1 from above | `NODE_1` | `TAG_1` | PuTTY |
| C, receiver | new board | `NODE_3` | `TAG_3` | PuTTY |

**Before blocking**, every alert at every node arrived once at `ttl=4` with `via` = the origin's own tag, and each node relayed each new alert once (11–45 ms jitter). The queue held 3–5 packets (own alert plus relays) with no evictions; `dups` climbed into the hundreds, since each alert now also arrives as other nodes' relays.

**After `b TAG_2` on C**, one of A's alerts as seen by both serial boards (A had just restarted after its power bank cut out, hence `ts=3872`):

B:
```
[mesh] rx src=NODE_2 msg_id=64816 ttl=4 via=TAG_2 rssi=-65 dups=870 class=1 conf=200 peak=853 ts=3872
[mesh] relay ttl=3 in 23 ms (relays=69)
```

C:
```
[mesh] rx src=NODE_2 msg_id=64816 ttl=3 via=TAG_1 rssi=-55 dups=947 class=1 conf=200 peak=853 ts=3872
[mesh] relay ttl=2 in 42 ms (relays=70)
```

What this shows:

- **Two-hop delivery.** C received A's alert with the origin unchanged (`src`, `msg_id`), one hop used (`ttl=3`), delivered by B's radio (`via=TAG_1`), once.
- **The flood continues.** C relayed it again at `ttl=2`.
- **Reboot handling**, again: A's new `msg_id`s after a power loss were accepted.

Caveats:

- **One alert.** The pass is shown for `msg_id` 64816. The planned follow-ups (more alerts all arriving `ttl=3 via=TAG_1`, then blocking B as well so A's alerts stop reaching C) were not captured.
- **Block status unconfirmed.** The first `b` on C printed `blocked: 00bb` instead of the typed tag. The console parser returns the right value on a PC for `b <tag>` with and without the space and with `\r\n`, so the cause is open (a likely suspect is a right-click in PuTTY pasting the clipboard into the board). The block was retyped before the excerpt above, but its status line was not captured. With only this one alert, C hearing B's relay before A's own copy by chance can't be fully ruled out.
- **Power banks** cut out again during this run (see Findings).

## Re-test on the async_context build

`eec71ea` (mesh code ported to `async_context` workers) flashed to all three boards, same roles and block (`b TAG_2` on C), boards running for about 20 minutes.

C:
```
[mesh] rx src=NODE_2 msg_id=31808 ttl=3 via=TAG_1 rssi=-46 dups=3098 class=1 conf=200 peak=853 ts=13870
[mesh] relay ttl=2 in 49 ms (relays=260)
```

B, next alert:
```
[mesh] rx src=NODE_2 msg_id=31809 ttl=4 via=TAG_2 rssi=-60 dups=3647 class=1 conf=200 peak=853 ts=18870
[mesh] relay ttl=3 in 28 ms (relays=256)
```

Same result as before the port: A's alerts reach C only through B (`ttl=3`, `via=TAG_1`), C relays on at `ttl=2`, each alert prints once per board, and the queues held 4–5 packets (own alert plus relays) with no evictions. Over about 20 minutes each board relayed 250+ alerts. A's power bank cut out once more during the run (`ts=13870` after a restart).

Still not captured: C's `s` status line confirming `blocked: TAG_2`, and the control step (blocking B as well).

## Findings

- **Power banks can switch off a node.** Board 2's power bank turned itself off three times during the session, presumably because an idling Pico draws too little current to keep it on. For the demo: use packs with an always-on / low-current mode, or other battery packs, and run each node on its pack for at least 30 minutes beforehand.
- A node's own alert at a 5 s beacon and 5 s lifetime leaves only one own packet in the queue at a time; the turnover shows as `expired` immediately followed by the next `on air`.
