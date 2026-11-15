# 2026-11-14: Bare-bones base-station decoder, unit tests and simulator run

Software-only check of `base-station/` on the `base-station` branch: the unit tests, lint, and an end-to-end run of `serra-base --source sim`. No Pi and no Picos. The live BLE path was not run (see [What it does not show](#what-it-does-not-show)).

**Result:** all 31 unit tests pass, ruff is clean, and the simulator pipeline (source → decode → dedup → NDJSON events, plus `--record`) behaves as the README describes. Every counter reconciles, and re-decoding the recorded capture offline gives the same unique packets.

## Setup

| | |
|---|---|
| Branch | `base-station` at `be45c81` (`Merge branch 'main' into base-station`), clean tree |
| Host | macOS (Darwin 25.6.0), Apple Silicon laptop |
| Toolchain | uv 0.13.7, Python 3.13.18, pytest 9.2.0, ruff 0.17.5, bleak 3.1.0 (from `uv.lock`, `--frozen`) |
| Hardware | None. `--source sim` only |

## Commands

```bash
cd base-station
uv run --frozen pytest -v
uv run --frozen ruff check .
uv run --frozen ruff format --check .
```

The end-to-end checks ran from a throwaway Python harness, which is not committed. It starts `python -m serra_base` as a subprocess, stops it with SIGINT, and parses stdout, stderr and the capture. It did five runs:

1. `--source sim --seed 42 --interval 0.2 -v --record <tmp>/cap.ndjson`, 5 s, then SIGINT
2. `--source sim --record /dev/null/x.ndjson` (a path that can't be opened)
3. `--magic 0x1FF` (out of range)
4. `--source sim --seed 42 --interval 0.2 -v --magic 0x42`, 2 s, then SIGINT
5. `python -m serra_base --source sim --interval 0.05 | head -n 3` (the reader closes stdout early)

Firmware cross-check: compared `firmware/mesh/packet.h` (`mesh_pkt_t`, `alert_payload_t` and their `static_assert`s) against `HEADER` / `ALERT` in `protocol.py`.

## Raw output

pytest:

```
collected 31 items
tests/test_dedup.py ........                                             [ 25%]
tests/test_events.py ...                                                 [ 35%]
tests/test_protocol.py ....................                              [100%]
============================== 31 passed in 0.01s ==============================
```

ruff:

```
All checks passed!
15 files already formatted
```

Simulator run (run 1):

```
exit code: 0
serra-base: run_id=a66a97 source=sim magic=0x5e company_id=0xffff
serra-base: exit adverts=56 packets=24 duplicates=29 bad_magic=3 too_short=0 unknown_type=0
events: 24  unique (src,msg_id): 24
seq contiguous: True
types: ['ALERT', 'HEARTBEAT']
run_id consistent: True
capture lines: 56
verbose drop lines: 32  kinds: ['bad_magic', 'duplicate']
counters reconcile (adverts == packets + drops == capture lines): True
packets == events on stdout: True
offline re-decode of capture -> unique packets: 24  match: True
```

Sample event and the matching capture line:

```
{"run_id":"a66a97","seq":1,"t_ms":845185417,"rssi":-79,"raw":"5e7f3bffffd18c0401018e86039c62020003","magic":94,"src":15231,"dst":65535,"msg_id":36049,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.5569,"peak_level":902,"peak_db":90.2,"timestamp":156316,"blast_count":3}}
{"t_ms": 845185417, "addr": "SIM:3B7F", "rssi": -79, "data": "5e7f3bffffd18c0401018e86039c62020003"}
```

Error and edge paths (runs 2–5):

```
--record bad path : exit 2 | serra-base: error: cannot open --record file: [Errno 17] File exists: '/dev/null'
--magic 0x1FF     : exit 2 | serra-base: error: --magic must fit in one byte
--magic 0x42 sim  : exit 0 | 10 events, all magic 0x42
| head -n 3       : 3 lines read, no traceback | serra-base: exit adverts=8 packets=4 duplicates=4 bad_magic=0 too_short=0 unknown_type=0
```

## What this shows

- **The wire format matches the firmware.** Field order, widths and signedness line up with `packet.h`: header `<BHHHBB`, alert `<BBhIB`, 9 + 9 bytes, little-endian. The `test_sizes_match_firmware` and vector tests pin this.
- **Decode handles every packet kind and rejection.** The README example packet, all three alert classes, a negative `peak_level`, an empty heartbeat, unicast `dst`, a custom magic and trailing bytes all decode. Empty, wrong-magic, short-header, truncated-alert and unknown-type packets are rejected with the right `reason`.
- **Dedup works end to end.** 56 adverts over 2–4 paths each became 24 unique `(src, msg_id)` events, with no repeats on stdout. The unit tests cover the 60 s expiry, the refresh on every copy, and pruning.
- **Nothing is lost or double-counted.** `adverts = packets + duplicates + bad_magic + too_short + unknown_type`, and both equal the capture's line count.
- **The capture is complete.** `--record` writes every raw advert, drops included, and re-decoding it offline gives the same 24 packets. That's the basis `replay.py` will need.
- **The CLI fails cleanly.** A bad `--record` path and an out-of-range `--magic` exit 2 with one line on stderr. SIGINT and a closed stdout exit 0 with a final counters line and no traceback.

## What it does not show

- **The live BLE source.** `sources/ble.py` has no tests and was not run. Not checked: the same-address repeat filter, the 30 s silence restart, the queue-full warning, the RSSI sentinel mapping, and BlueZ behaviour on the Pi. This needs a run on the Pi 5 against real Picos, or nRF Connect as in the README's test recipe.
- **`too_short` and `unknown_type` from the CLI.** The simulator never sends them, so those counters are covered only by `test_protocol.py`.
- **`__main__.py`, `recorder.py` and `sim.py`.** None of them has a unit test. This report's harness is the only check, and it isn't in the repo.
- **Anything not built yet.** These are 0-byte placeholders: `server.py` (SSE `/events`, `/health`), `sources/replay.py`, `deploy/serra-base.service` and `deploy/setup-pi.sh`. The README says the server and replay are planned. Its Pi setup step 4 still tells you to run `sudo deploy/setup-pi.sh`, which does nothing today.
- **Long runs.** The longest run was 5 s, so memory growth, the 10 s stats line and dedup expiry under real timing were not checked.

## Findings

1. **The bare-bones decoder is in good shape for its scope.** There were no failures, lint issues or crashes.
2. **Biggest coverage gap: `ble.py`.** It is the one path the demo depends on, and it has no automated test. A test with a fake scanner, feeding `on_advert` directly, would cover the repeat filter and the silence restart without hardware.
3. **Promote the smoke harness to a test.** A `tests/test_cli.py` running `--source sim --seed` for a few seconds would lock in counter reconciliation, the `--record` round trip and the clean-exit paths.
4. **README vs placeholders.** Mark Pi setup step 4 as planned, or fill in `setup-pi.sh` and `serra-base.service`, before anyone follows the setup steps on the Pi.
5. **Next hardware session:** run `--source ble -v --record` on the Pi 5 with two or more Picos, and check dedup on real multi-path floods. Then file it here as the first BLE report.
