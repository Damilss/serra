# 2026-11-14: Base-station SSE server, `/health`, pinned constants and app alignment

Software-only check of the new HTTP side of `base-station/` on the `base-station` branch. It covers unit tests, lint, an end-to-end run of `serra-base --source sim` against the real server, a check that the wire constants match `firmware/mesh/packet.h`, and a read-only check of the `app` branch against the event contract. No Pi and no Picos. The live BLE path and the systemd unit were not run (see [What it does not show](#what-it-does-not-show)).

**Result:** all 63 unit tests pass, and ruff and shellcheck are clean. `/events` and `/health` behave as the README describes: framing, resume, live-only without `Last-Event-ID`, CORS, client count, port-in-use exit, and clean Ctrl-C with a client attached. The firmware constants and the app's `peak_level` units agree with the decoder.

## Setup

| | |
|---|---|
| Branch | `base-station` at `297ef28` plus this change (uncommitted) |
| Host | macOS (Darwin 25.6.0), Apple Silicon laptop |
| Toolchain | uv 0.13.7, Python 3.13.18, aiohttp 3.14.5, bleak 3.1.0 (from `uv.lock`, `--frozen`), shellcheck (Homebrew) |
| App side | `origin/app` at `67d6e89`, read with `git show` (not checked out) |
| Hardware | None. `--source sim` only |

## Commands

```bash
cd base-station
uv run --frozen pytest -v
uv run --frozen ruff check .
uv run --frozen ruff format --check .
shellcheck deploy/setup-pi.sh && bash -n deploy/setup-pi.sh
```

The end-to-end checks ran from a throwaway Python harness, which is not committed. It starts `python -m serra_base --source sim --seed 42 --interval 0.2 --host 127.0.0.1 --port 18090`, talks to it with `http.client`, starts a second instance on the same port, then sends SIGINT while an `/events` client is still connected.

## Raw output

pytest (per file):

```
   8 tests/test_ble.py
   2 tests/test_cli.py
   8 tests/test_dedup.py
   3 tests/test_events.py
  29 tests/test_protocol.py      (9 of them: constants vs packet.h)
  13 tests/test_server.py
============================== 63 passed in 0.63s ==============================
```

ruff and shellcheck:

```
All checks passed!
18 files already formatted
shell ok
```

End-to-end harness:

```
health at start: {"version": "0.2.0", "run_id": "67d8c0", "source": "sim", "scanner": "up", "company_id": 65535, "magic": 94, "uptime_s": 0, "clients": 0, "counts": {"adverts": 2, "packets": 1, "duplicates": 1, "bad_magic": 0, "too_short": 0, "unknown_type": 0}}
headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*'}
first lines: ['retry: 2000', '', 'id: 67d8c0:2', 'event: packet', 'data: {"run_id":"67d8c0","seq":2,...,"alert":{"class":"whistle","confidence":0.6667,"peak_level":932,"peak_db":93.2,"timestamp":156533,"blast_count":3}}']
health with client: {... "uptime_s": 2, "clients": 1, "counts": {"adverts": 23, "packets": 10, "duplicates": 12, "bad_magic": 1, ...}}
live ids: 9 ['67d8c0:2', '67d8c0:3', '67d8c0:4'] ...
resume from 67d8c0:7 -> ['67d8c0:8', '67d8c0:9', '67d8c0:10', '67d8c0:11', '67d8c0:12', '67d8c0:13']
resume starts right after: True
other run_id -> first id 67d8c0:1 count >= packets so far: True
no Last-Event-ID -> backlog ids: []
second instance exit: 2 | serra-base: error: cannot listen on 127.0.0.1:18090: error while attempting to bind on address ('127.0.0.1', 18090): [errno 48] address already in use
GET /nope -> 404
SIGINT exit: 0 in 0.04s; traceback: False
stderr tail: serra-base: exit adverts=41 packets=18 duplicates=21 bad_magic=2 too_short=0 unknown_type=0
stdout events: 18 seq contiguous: True
```

Constants parsed from `firmware/mesh/packet.h` by the new test:

```
{'MESH_MAGIC': 94, 'MESH_COMPANY_ID': 65535, 'MESH_DST_BROADCAST': 65535, 'MESH_TTL_DEFAULT': 4, 'MESH_ADV_BUDGET': 24,
 'MESH_TYPE_ALERT': 1, 'MESH_TYPE_HEARTBEAT': 2, 'CLASS_WHISTLE': 1, 'CLASS_SCREAM': 2, 'CLASS_HELP': 3}
```

## App alignment (`origin/app` at `67d6e89`)

| Field | Decoder event | App | Agrees |
|---|---|---|---|
| Magic | `0x5E` (94) | `lib/packets.ts`: `MESH_MAGIC = 0x5e`; `packets.spec.js` | yes |
| `peak_level` | i16, tenths of a dB, passed through | schema `smallint`, "tenths of a dB (853 = 85.3 dB)"; `lib/types.ts`, `lib/venue.ts`, `packets.spec.js` (898 → `82 03`) | yes |
| `peak_db` | `peak_level / 10` | schema generated `peak_level / 10.0`; `lib/format.ts` `db = peak / 10` | yes; the ingest must **not** write it (generated column) |
| Seed levels | | `seed.sql`: 898, 593, 502 (89.8 / 59.3 / 50.2 dB) | yes; the old "3100 for 62 dB" item is fixed |
| `confidence` | `confidence / 255`, 4 decimals | `real` 0–1, "alert_payload_t.confidence / 255" | yes |
| `hops` | `4 - ttl` | schema "4 - ttl on arrival"; `lib/packets.ts` `TTL_DEFAULT = 4` | yes |
| `alert.class` | `whistle` / `scream` / `help` | `alerts.class` check constraint, same three | yes |
| `type` | `"ALERT"` / `"HEARTBEAT"` | `packets.type` check constraint, same two | yes |
| `raw` | lowercase hex | `packets.raw bytea` (ingest decodes the hex) | yes |
| `alert.timestamp` | node uptime ms | `alerts.node_uptime_ms bigint` | yes |
| HEARTBEAT payload | not decoded (bytes in `raw`) | proposal: `battery_pct` u8, `millivolts` u16 | open: firmware hasn't defined it |

## What this shows

- **The SSE contract works as specified.** Every message is `id: <run_id>:<seq>` / `event: packet` / `data: <json>`. The stream opens with `retry: 2000`. Resuming with the same `run_id` resends exactly the events after the given `seq`. Another `run_id` gets the whole buffer, and no header means live only. The buffer holds 1,000 events (unit test with 1,200).
- **A slow client can't stall the scanner.** A client whose queue fills is disconnected, and `publish` never waits (`test_slow_client_is_disconnected_not_waited_for`).
- **`/health` matches the README shape**, with live counters, client count, `uptime_s` and `version` 0.2.0. `pyproject.toml` was 0.1.0 and now matches `__init__.py`.
- **Bluetooth loss no longer ends the run.** With a fake source that fails once, `scanner` goes `down`, the source is reopened, and `run_id` and `seq` carry on (`test_cli.py`). The BLE source reports `starting` → `up`, and again around a silence restart (`test_ble.py`).
- **Clean failure and shutdown.** A taken port exits 2 with one line. SIGINT with a client attached exits 0 in 0.04 s with the final counters line and no traceback. Stdout NDJSON is unchanged (18 events, contiguous `seq`).
- **The constants are pinned.** `MAGIC`, `COMPANY_ID`, `DST_BROADCAST`, `TTL_INITIAL`, the type IDs and the class IDs are read from `packet.h` and compared on every test run. If one side changes, the test fails until the other does too.

## What it does not show

- **Live BLE and the real Bluetooth-loss path.** `ble.scan()` was only driven by a fake scanner. Nobody pulled the adapter on the Pi or switched Bluetooth off on macOS to watch `/health` go `down` and then back to `up`.
- **`deploy/`.** `setup-pi.sh` passes `bash -n` and shellcheck, but it has never run on a real Pi. Its `--uninstall` path and the install dry run were exercised on macOS with stand-ins for `id`, `uname`, `systemctl` and `getent`, and the unit path pointed at a temp dir. That covers the argument handling, the idempotency and the commands issued, not systemd's behavior. `serra-base.service` wasn't checked with `systemd-analyze verify` (not available on macOS). Still to check on the Pi: the `bluetooth` group and D-Bus permissions, `KillSignal=SIGINT` giving the clean exit, and start-on-boot in gadget mode.
- **The USB link.** Everything ran on `127.0.0.1`, not `10.12.194.1` over CDC-ECM.
- **The real ingest.** `app/` has no SSE client yet, so the alignment above is a read of the schema and the TypeScript, not a run.
- **Long runs.** The longest run was about 4 s. The 15 s ping only ran with a shortened interval in a unit test.

## Findings

1. **The HTTP side is ready for `app/` to build its ingest against `--source sim`.** The ingest should store the last event ID it saw and send it as `Last-Event-ID` on startup. Without the header it gets live events only.
2. **The ingest must not write `peak_db`.** It's a generated column in the schema, and inserting it errors. Write `peak_level` only.
3. **`app` branch follow-up:** the migration header and `app/supabase/README.md` still describe the Pi writing Supabase with `service_role`. The topology is now the laptop pulling `/events`. Fix it on `app`.
4. **The HEARTBEAT payload is still open.** The app's proposal (`battery_pct` u8 + `millivolts` u16) needs a firmware decision, followed by a `packet.h` struct, `protocol.py`, a vector and the pin test, all in one PR.
5. **Next hardware session:** run `sudo deploy/setup-pi.sh` on the Pi 5 and reboot. Check `curl http://10.12.194.1:8080/health` and `curl -N .../events` from the laptop with two or more Picos. Then toggle Bluetooth off and on, and confirm `/health` goes `down` → `up` while the `run_id` stays the same.
