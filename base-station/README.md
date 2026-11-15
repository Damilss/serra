# Serra base station (decoder)

The base station is the **decoder**. It runs on the Raspberry Pi 5, listens to the Serranet over BLE, decodes and deduplicates Serranet packets, and streams them as JSON to the demo laptop over a USB cable. The app (local Supabase and the dashboard, in `app/`) runs on the laptop and does everything after decoding.

Python 3.13, [bleak](https://github.com/hbldh/bleak) and [aiohttp](https://docs.aiohttp.org), managed with [uv](https://docs.astral.sh/uv/).

**Status:** decoder and server built. `serra-base --source ble|sim` scans (or simulates), decodes and deduplicates, serves the events over SSE on `GET /events` with status on `GET /health`, and also prints one JSON event per line to stdout, with counters on stderr. Replay (`--source replay`) is not built yet. This README is the contract `app/` codes against.

---

## Contents

1. [Data flow](#data-flow)
2. [What runs where](#what-runs-where)
3. [Repository layout](#repository-layout)
4. [Input: Serranet packets](#input-serranet-packets)
5. [Output: event stream](#output-event-stream)
6. [Running it](#running-it)
7. [Pi setup](#pi-setup-once)
8. [Gotchas](#gotchas)
9. [Development](#development)
10. [Open items](#open-items)

---

## Data flow

```
  Field             Raspberry Pi 5 (serra-base)                   Demo laptop (app/)

  Serranodes ─BLE─▶ scan ─▶ decode ─▶ dedup ─▶ /events ══USB-C══▶ ingest ─▶ Supabase ─▶ dashboard
  (Pico 2 W)         │                          (SSE)  10.12.194.1                  (Realtime)
                     └─▶ recorder ─▶ captures/*.ndjson
```

Inside `serra-base`, every source produces the same raw advertisements, so the rest of the pipeline can't tell a real radio from a simulation or a recording:

```
sources/ble.py    ─┐
sources/sim.py    ─┼─▶ raw advert ─┬─▶ protocol.decode() ─▶ dedup ─▶ events ─▶ server (/events, /health)
sources/replay.py ─┘               └─▶ recorder (--record) ─▶ captures/*.ndjson
```

### The USB link

The Pi 5's USB-C port runs in gadget mode with Raspberry Pi's [`rpi-usb-gadget`](https://github.com/raspberrypi/rpi-usb-gadget) package. The laptop sees a USB Ethernet adapter (CDC-ECM on macOS and Linux, RNDIS on Windows), so the link is plain IP. In the default SHARED mode the Pi is always **`10.12.194.1`** and hands the laptop an address in `10.12.194.0/28`. No Wi-Fi, no router, no internet.

### Why the laptop connects to the Pi

The laptop pulls events from the Pi; the Pi doesn't push into Supabase.

- **Fixed address.** The Pi is always `10.12.194.1`. The laptop's address on the link comes from DHCP.
- **Secrets stay on the laptop.** The Supabase `service_role` key never leaves it.
- **No Supabase dependency here.** `app/` can be built against `--source sim` today, with no Pi and no Picos.
- **Survives cable blips.** SSE clients reconnect on their own and resume with `Last-Event-ID`.
- **Stage fallback.** bleak also runs on macOS. If the Pi dies, run `serra-base` on the laptop and point the ingest at `localhost`.

---

## What runs where

| Step | Where | Why there |
|---|---|---|
| BLE scan, filter on company ID `0xFFFF` | Pi | The Pi is the radio |
| Decode bytes into fields | Pi | `protocol.py` is the Python side of the wire format |
| Drop repeats by `(src, msg_id)` | Pi | The same alert arrives via several paths |
| Record raw advertisements | Pi | Replay later; backup if the radio misbehaves at the venue |
| Stamp wall-clock time | Laptop | The Pi's clock isn't reliable here (see [Gotchas](#gotchas)) |
| Group alerts into events (~2 s window) | Laptop (`app/`) | It owns the `alerts` and `alert_readings` rows |
| Estimate location (loudness-weighted) | Laptop (`app/`) | Needs node positions, which live in Supabase |
| Write Supabase, summaries, dashboard | Laptop (`app/`) | Holds the `service_role` key |

---

## Repository layout

```
base-station/
├── README.md               # this file: plan, data flow, the event contract
├── pyproject.toml          # uv project: bleak, aiohttp · dev: ruff, pytest · script: serra-base
├── uv.lock                 # committed, with pyproject.toml
├── .python-version         # 3.13 (Raspberry Pi OS Trixie)
├── src/serra_base/         # import name serra_base; the command is serra-base
│   ├── __init__.py
│   ├── __main__.py         # CLI: picks the source, starts the server, retries a failed source
│   ├── protocol.py         # wire format: constants, struct layouts, decode(). Python twin of mesh_pkt_t
│   ├── dedup.py            # recently-seen cache keyed on (src, msg_id), expires after 60 s unheard
│   ├── events.py           # decoded packet -> JSON event (the Pi <-> laptop contract)
│   ├── server.py           # aiohttp: GET /events (SSE), GET /health
│   ├── recorder.py         # appends raw advertisements to NDJSON (feeds replay)
│   └── sources/
│       ├── __init__.py     # Source interface: async iterator of raw advertisements
│       ├── ble.py          # bleak scanner, keeps manufacturer data under company 0xFFFF
│       ├── sim.py          # fake mesh (placeholder node IDs until app/supabase/seed.sql exists)
│       └── replay.py       # replays a recorded capture with its original timing
├── tests/
│   ├── vectors.json        # golden packets: hex bytes + expected fields
│   ├── test_protocol.py    # decode the vectors, reject bad magic / short packets, constants match packet.h
│   ├── test_dedup.py       # repeats dropped, entries expire
│   ├── test_events.py      # packet -> event JSON
│   ├── test_ble.py         # BLE source with a fake scanner: repeat throttle, scanner state
│   ├── test_server.py      # /events framing, resume, slow clients; /health
│   └── test_cli.py         # a failed source is retried without ending the run
├── captures/               # recorded sessions; not committed, except one small sample
└── deploy/
    ├── setup-pi.sh         # one-time Pi setup: uv sync, bluetooth group, installs and starts the unit; --uninstall removes it
    └── serra-base.service  # systemd unit template: start on boot, restart on crash
```

---

## Input: Serranet packets

Source of truth: the root README's [Mesh protocol (Serranet)](../README.md#mesh-protocol-serranet). `protocol.py` mirrors it, and changes follow the [packet format contract](../CONTRIBUTING.md#the-packet-format-is-a-contract): firmware, base station, README and the Supabase migration change in the same PR.

Each Serranet packet is one legacy BLE advertisement carrying manufacturer-specific data under the testing company ID `0xFFFF`. bleak returns that data with the company ID already removed (`advertisement_data.manufacturer_data[0xFFFF]`), so decoding starts at the magic byte. Everything is little-endian.

**Header**, `struct` format `<BHHHBB`, 9 bytes:

| Field | Type | Notes |
|---|---|---|
| `magic` | u8 | Not ours → dropped (counted in `/health`) |
| `src` | u16 | Origin node ID |
| `dst` | u16 | `0xFFFF` = broadcast. Passed through; the base station accepts every `dst` |
| `msg_id` | u16 | Per-origin sequence number. `(src, msg_id)` is the dedup key |
| `ttl` | u8 | Hops remaining. `hops = TTL_INITIAL - ttl` |
| `type` | u8 | `ALERT`, `HEARTBEAT` |

**`ALERT` payload**, `struct` format `<BBhIB`, 9 bytes:

| Field | Type | Decoded as |
|---|---|---|
| `class_id` | u8 | `1` → `whistle`, `2` → `scream`, `3` → `help` |
| `confidence` | u8 | `confidence / 255`, rounded to 4 decimals |
| `peak_level` | i16 | Tenths of a dB; `peak_db = peak_level / 10` |
| `timestamp` | u32 | Origin node uptime in ms. Not synced across nodes; never compared between nodes |
| `blast_count` | u8 | Whistles only (3 = distress pattern); 0 for scream and help |

**`HEARTBEAT` payload:** not defined yet. Until it is, heartbeats are passed through with their bytes in `raw` and no decoded payload.

**Constants**, pinned to `firmware/mesh/packet.h`. `tests/test_protocol.py` reads that header and fails if any of them differ, so the two sides change together:

| Constant | Value | Firmware twin |
|---|---|---|
| `MAGIC` | `0x5E` | `MESH_MAGIC` |
| `COMPANY_ID`, `DST_BROADCAST` | `0xFFFF`, `0xFFFF` | `MESH_COMPANY_ID`, `MESH_DST_BROADCAST` |
| `TYPE_ALERT`, `TYPE_HEARTBEAT` | `1`, `2` | `MESH_TYPE_ALERT`, `MESH_TYPE_HEARTBEAT` |
| `TTL_INITIAL` | `4` | `MESH_TTL_DEFAULT`: every packet starts with it, so `hops = 4 - ttl` (the Supabase schema assumes the same). Still tunable for the demo layout; change both sides together |
| `CLASS_WHISTLE`, `CLASS_SCREAM`, `CLASS_HELP` | `1`, `2`, `3` | same names |

**Dropped before decoding:** wrong magic, too short for the header or the payload, unknown `type`. Each case has its own counter in `/health`, and `--record` keeps the raw bytes, so nothing is lost while the firmware is changing.

**Dedup:** the first copy of each `(src, msg_id)` wins; later copies are dropped and counted. An entry expires once 60 seconds pass without a copy of it, the same window the nodes use, so a node that reboots and reuses a `msg_id` still gets through after a minute of quiet. Every copy restarts the 60 s, so a packet that stays on air is dropped for as long as it is heard, not re-emitted every minute. Before dedup, the BLE source also skips an advert whose bytes are identical to the last one from the same address (see [Gotchas](#gotchas)).

---

## Output: event stream

`serra-base` serves HTTP on port `8080`, on all interfaces.

### `GET /events`

A [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) stream (`text/event-stream`), one message per deduplicated packet:

```
id: 6f1c2a:1832
event: packet
data: {"run_id":"6f1c2a","seq":1832,"t_ms":5123456,"rssi":-66,"raw":"5e4e1cffff1e010101019e5503c089460103", ...}
```

The `data` line, expanded:

```json
{
  "run_id": "6f1c2a",
  "seq": 1832,
  "t_ms": 5123456,
  "rssi": -66,
  "raw": "5e4e1cffff1e010101019e5503c089460103",
  "magic": 94,
  "src": 7246,
  "dst": 65535,
  "msg_id": 286,
  "ttl": 1,
  "hops": 3,
  "type": "ALERT",
  "alert": {
    "class": "whistle",
    "confidence": 0.6196,
    "peak_level": 853,
    "peak_db": 85.3,
    "timestamp": 21400000,
    "blast_count": 3
  }
}
```

| Field | Meaning |
|---|---|
| `run_id` | Random ID chosen when `serra-base` starts. A new value means `seq` and `t_ms` restarted |
| `seq` | Event counter for this run, starting at 1 |
| `t_ms` | Pi monotonic clock, in ms, when the advertisement arrived. Use it for the ~2 s grouping window, never as wall-clock time |
| `rssi` | Signal strength at the base, in dBm, of the **last hop**, not of the origin node. `null` when the radio gave no reading |
| `raw` | Manufacturer data as received (after the company ID), lowercase hex. Goes into `packets.raw` |
| `magic` … `type` | Header fields, as in [Input](#input-serranet-packets). `type` is `"ALERT"` or `"HEARTBEAT"` |
| `hops` | `TTL_INITIAL - ttl` |
| `alert` | Present only when `type` is `"ALERT"` |

The example is a real encoding: node `7246` (`0x1C4E`), `msg_id` 286, three hops out, a whistle at 62% confidence, 85.3 dB, three blasts. It should be the first entry in `tests/vectors.json`.

The stream opens with `retry: 2000` (reconnect after 2 s) and sends a `: ping` comment line after 15 s with no events, so proxies and dead connections don't hang. Responses carry `Access-Control-Allow-Origin: *`, so the dashboard can open the stream straight from the browser.

**Resuming:** the server keeps the last 1,000 events. A client that reconnects with `Last-Event-ID` gets what it missed, as long as it's still buffered. If the `run_id` in that ID no longer matches, the client gets the whole buffer. A client that connects **without** `Last-Event-ID` gets live events only, nothing from before it connected. Browsers' `EventSource` sends `Last-Event-ID` automatically when it reconnects. A non-browser ingest should remember the last ID it stored and send it when it starts up.

**Slow clients:** a client that falls 256 events behind is disconnected instead of being waited for, because waiting would stall the scanner. It reconnects with `Last-Event-ID` and catches up from the buffer.

**Ingest note:** `peak_db` is in the event for display. The Supabase schema generates `peak_db` from `peak_level`, so the ingest writes `peak_level` only (writing `peak_db` is an error).

**Debugging:** `curl -N http://10.12.194.1:8080/events` prints the live stream.

### `GET /health`

Decoder status as JSON, for the dashboard's boot screen and for checking the setup before going on stage:

```json
{
  "version": "0.1.0",
  "run_id": "6f1c2a",
  "source": "ble",
  "scanner": "up",
  "company_id": 65535,
  "magic": 94,
  "uptime_s": 812,
  "clients": 1,
  "counts": {
    "adverts": 4210,
    "packets": 57,
    "duplicates": 112,
    "bad_magic": 3,
    "too_short": 0,
    "unknown_type": 0
  }
}
```

`scanner` is `up`, `starting` or `down` (Bluetooth off or adapter missing; serra-base keeps running and retries every 5 s, see [Gotchas](#gotchas)). With `--source sim` it's always `up`. `uptime_s` and the counters belong to the `run_id`; `clients` is the number of open `/events` streams. `adverts` counts every advertisement under company `0xFFFF`; `packets` counts what went out on `/events`.

---

## Running it

Commands, from `base-station/`. Run `uv sync` once first.

**Works today:** `uv run serra-base --source sim` and `uv run serra-base --source ble [-v] [--record captures/x.ndjson]`. Both serve `/events` and `/health` on port 8080, and also print one JSON event per line (the [event](#output-event-stream) without the SSE framing) to stdout, with counters on stderr. `--source replay` is planned. If the port is taken, serra-base exits 2 with a one-line error.

| Where | Command | For | |
|---|---|---|---|
| Laptop | `uv run serra-base --source sim` | Building `app/` with no Pi and no Picos: fake alerts and heartbeats from three placeholder node IDs (`0x1C4E`, `0x2A10`, `0x3B7F`) until `app/supabase/seed.sql` exists | now |
| Laptop | `uv run serra-base --source replay captures/sample.ndjson` | Replaying a recorded session, timing included | planned |
| Pi | `uv run serra-base --source ble --record captures/demo.ndjson` | The real thing (the systemd unit runs the same thing, recording to `captures/live.ndjson`) | now |
| Laptop | `uv run serra-base --source ble` | Stage fallback if the Pi fails. Point the ingest at `http://localhost:8080` | now |

| Option | Default | | |
|---|---|---|---|
| `--source` | `ble` | `ble`, `sim` or `replay <file>` | `ble`, `sim` now; `replay` planned |
| `--record <file>` | off | Append every new advertisement under company `0xFFFF` (identical repeats from the same address are skipped), **before** decoding, as NDJSON: `{"t_ms": ..., "addr": "...", "rssi": -66, "data": "<hex>"}` | now |
| `--magic` | `0x5E` | Magic byte to accept. Override while firmware and decoder disagree | now |
| `--company-id` | `0xFFFF` | Manufacturer-data company ID to scan for | now |
| `--verbose`, `-v` | off | More detail on stderr | now |
| `--seed` | random | `sim` only: seed for a repeatable fake mesh | now |
| `--interval` | `2.0` | `sim` only: seconds between simulated alerts. Each alert is heard over several paths (2–4 adverts), with an occasional heartbeat or bad-magic advert in between | now |
| `--host` | `0.0.0.0` | Listen address | now |
| `--port` | `8080` | Listen port | now |

**Testing with a phone:**

- In nRF Connect's advertiser, add manufacturer data with company `0xFFFF` and value `5e4e1cffff1e010101019e5503c089460103` (the [example](#output-event-stream) packet), then run `uv run serra-base --source ble -v` and, in another terminal, `curl -N localhost:8080/events`. Change the `msg_id` bytes (bytes 6–7, `1e01`) to see a new event. While the phone keeps advertising the same bytes, no new event appears: repeats from the same address are skipped, and dedup drops the rest for as long as the packet stays on air.

---

## Pi setup (once)

Do this **before the event, with internet**. In gadget mode the Pi has no internet, so dependencies have to be installed beforehand.

1. **Flash** Raspberry Pi OS Trixie (64-bit). Images dated 2025-10-20 or later ship `rpi-usb-gadget`; on older ones, `sudo apt install rpi-usb-gadget`.
2. **Get the code onto the Pi** over Wi-Fi: clone the repo, install uv, then run `uv sync` in `base-station/`.
3. **Turn on gadget mode:** `sudo rpi-usb-gadget on`, then reboot.
4. **Install the service** (still with internet): `sudo deploy/setup-pi.sh`, run from your normal user. It runs `uv sync`, adds you to the `bluetooth` group, and installs and starts `serra-base.service` from this checkout, so the decoder starts on boot, records to `captures/live.ndjson` and restarts if it crashes. Logs: `journalctl -u serra-base -f`.
5. **Connect** the Pi's USB-C port to the laptop (through a powered hub, see below), wait for it to boot, then from the laptop:
   ```bash
   ssh <user>@10.12.194.1
   curl http://10.12.194.1:8080/health
   ```

**Power:** in gadget mode the Pi 5 is powered through the same USB-C cable that carries the data, and laptop ports often can't supply enough. Raspberry Pi recommends a powered USB hub between the laptop and the Pi. On the Pi, `vcgencmd get_throttled` should print `throttled=0x0`; anything else means undervoltage or throttling.

**Stopping or removing the service:**

- **To run `serra-base` by hand on the Pi** (e.g. `uv run serra-base --source ble -v` while debugging), stop the service first. Otherwise the second instance can't get port 8080 and exits 2.
  ```bash
  sudo systemctl stop serra-base     # free port 8080; it comes back on the next boot
  sudo systemctl start serra-base    # back to normal
  ```
- **To remove it** (reflashing, or using the Pi for something else): `sudo deploy/setup-pi.sh --uninstall` stops and disables the service and removes the unit. It keeps `captures/` (recordings), `.venv` and your `bluetooth` group membership (`sudo gpasswd -d <user> bluetooth` to leave the group). Running `sudo deploy/setup-pi.sh` again reinstalls it. `DRY_RUN=1` previews either one.

---

## Gotchas

- **The Pi's clock is wrong.** In gadget mode the Pi has no internet, so no NTP, and the Pi 5's real-time clock only keeps time with a battery fitted. Events therefore carry `t_ms` (Pi monotonic time) for grouping, and the laptop stamps wall-clock time. Never compare a Pi timestamp with a laptop timestamp.
- **The same advertisement is reported more than once.** On Linux, bleak goes through BlueZ and calls back on every change to a device's properties, an RSSI change included, each time with the cached manufacturer data; macOS may report every advertisement. So a node that keeps advertising one packet is seen again and again. `ble.py` passes on bytes identical to the last ones from the same address at most once every 10 s (the same sender repeating the same bytes is the same packet), and dedup drops any other repeat. Those throttled repeats aren't skipped outright on purpose: each one refreshes the packet's dedup entry, so a packet that stays on air for more than the 60 s window can't expire and come back as a new event when a relay copy arrives. A steady sender therefore adds about one `duplicates` count (and one `--record` line) every 10 s. Each new Serranet packet changes the bytes, so floods get through. Test it early: advertise changing manufacturer data under `0xFFFF` from nRF Connect on a phone and watch `/events`.
- **Losing Bluetooth mid-scan is silent.** If the adapter is powered off or unplugged, bluetoothd restarts, or macOS Bluetooth is toggled off after scanning starts, bleak raises nothing; adverts just stop. So after 30 s with no callback from any device, `ble.py` restarts the scan. A healthy adapter carries on. A missing one raises, and `serra-base` reports `scanner: "down"` on `/health`, logs one line, and reopens the scanner every 5 s until it's back. It doesn't exit: the server, the `run_id`, `seq` and dedup carry on, so SSE clients stay connected and nothing has to resync.
- **`0xFFFF` isn't ours alone.** It's the Bluetooth SIG's testing ID, so other test devices at a hackathon may use it. The magic byte is what tells our packets apart; watch `bad_magic` in `/health`.
- **RSSI is the last hop.** The base hears whichever node relayed the packet to it, so `rssi` says nothing about how loud or far away the origin node was. Location comes from `peak_level` in the alerts.
- **Never block the event loop.** Scanner callbacks, the dedup cache and the SSE server share one asyncio loop. A blocking call stalls the scanner, and advertisements are missed while it waits.

---

## Development

Follows [CONTRIBUTING](../CONTRIBUTING.md): Python with uv, formatted and linted with Ruff.

```bash
uv sync                  # install dependencies
uv run pytest            # tests
uv run ruff format       # format
uv run ruff check        # lint
```

- **Golden vectors.** `tests/vectors.json` lists packets as hex bytes with their expected fields, and the Python tests decode every one. Firmware should produce exactly these bytes for the same fields, so a vector is the quickest way to check that both sides agree.
- **Changing the wire format** means updating, in one PR: the firmware structs, `protocol.py`, `tests/vectors.json`, the root README's Mesh protocol section and the Supabase migration in `app/`. If old and new nodes can't understand each other, say so in the PR.
- **Changing the event JSON** means updating this README and the ingest in `app/` together. Adding a field is safe; renaming or removing one breaks the ingest.

---

## Open items

- [x] Pin `MAGIC` (`0x5E`), the type IDs (`1`, `2`), the class IDs and `TTL_INITIAL` (`4`) to `firmware/mesh/packet.h`. A test reads the header and fails if the two sides differ. `--magic` stays as a debugging override. `MESH_TTL_DEFAULT` can still be tuned for the demo layout, as long as `TTL_INITIAL` changes with it.
- [ ] Define the `HEARTBEAT` payload with firmware. The Supabase schema expects battery percentage and millivolts from it, and the app's packet view proposes `battery_pct` u8 then `millivolts` u16 (3 bytes). Until it's pinned, heartbeats pass through with their bytes in `raw`.
- [x] `peak_level` units agree with the app (checked against the `app` branch): tenths of a dB everywhere, and `seed.sql` now stores 898 / 593 / 502. The schema generates `peak_db`, so the ingest writes `peak_level` only.
- [ ] Test BlueZ delivery with nRF Connect (see [Gotchas](#gotchas)).
- [x] Check the Pi 5's power over the laptop's USB-C, with and without a powered hub.
- [x] Update the root README and CONTRIBUTING: the dashboard runs on the laptop, and the laptop pulls events from the Pi over USB.
- [ ] Run the service on the Pi: `sudo deploy/setup-pi.sh`, a reboot, then `curl http://10.12.194.1:8080/health` from the laptop.
- [ ] `app` branch: the migration header and `app/supabase/README.md` still say the Pi's BLE listener writes Supabase with the `service_role` key. The laptop's ingest pulls `/events` instead.

