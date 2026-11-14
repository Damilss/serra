# Serra base station (decoder)

The base station is the **decoder**. It runs on the Raspberry Pi 5, listens to the Serranet over BLE, decodes and deduplicates Serranet packets, and streams them as JSON to the demo laptop over a USB cable. The app (local Supabase and the dashboard, in `app/`) runs on the laptop and does everything after decoding.

Python 3.13, [bleak](https://github.com/hbldh/bleak) and [aiohttp](https://docs.aiohttp.org), managed with [uv](https://docs.astral.sh/uv/).

**Status:** scaffold only. The files exist but are empty; this README is the plan, and the contract `app/` codes against.

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
│   ├── __main__.py         # CLI: picks the source, starts the server
│   ├── protocol.py         # wire format: constants, struct layouts, decode(). Python twin of mesh_pkt_t
│   ├── dedup.py            # recently-seen cache keyed on (src, msg_id), 60 s expiry
│   ├── events.py           # decoded packet -> JSON event (the Pi <-> laptop contract)
│   ├── server.py           # aiohttp: GET /events (SSE), GET /health
│   ├── recorder.py         # appends raw advertisements to NDJSON (feeds replay)
│   └── sources/
│       ├── __init__.py     # Source interface: async iterator of raw advertisements
│       ├── ble.py          # bleak scanner, keeps manufacturer data under company 0xFFFF
│       ├── sim.py          # fake mesh using the node IDs in app/supabase/seed.sql
│       └── replay.py       # replays a recorded capture with its original timing
├── tests/
│   ├── vectors.json        # golden packets: hex bytes + expected fields
│   ├── test_protocol.py    # decode the vectors, reject bad magic / short packets
│   └── test_dedup.py       # repeats dropped, entries expire
├── captures/               # recorded sessions; not committed, except one small sample
└── deploy/
    ├── setup-pi.sh         # one-time Pi setup: gadget mode, uv, systemd unit
    └── serra-base.service  # systemd unit: start on boot, restart on crash
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

**Constants not pinned yet** (see [Open items](#open-items)):

| Constant | Working value | Where it comes from |
|---|---|---|
| `MAGIC` | `0x9E` | Dashboard mockup, marked as a placeholder |
| `TYPE_ALERT`, `TYPE_HEARTBEAT` | `1`, `2` | Dashboard mockup |
| `TTL_INITIAL` | `4` | Supabase schema (`hops = 4 - ttl`) |

**Dropped before decoding:** wrong magic, too short for the header or the payload, unknown `type`. Each case has its own counter in `/health`, and `--record` keeps the raw bytes, so nothing is lost while the firmware is changing.

**Dedup:** the first copy of each `(src, msg_id)` wins; later copies are dropped and counted. Entries expire after 60 seconds, the same window the nodes use, so a node that reboots and reuses a `msg_id` still gets through.

---

## Output: event stream

`serra-base` serves HTTP on port `8080`, on all interfaces.

### `GET /events`

A [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) stream (`text/event-stream`), one message per deduplicated packet:

```
id: 6f1c2a:1832
event: packet
data: {"run_id":"6f1c2a","seq":1832,"t_ms":5123456,"rssi":-66,"raw":"9e4e1cffff1e010101019e5503c089460103", ...}
```

The `data` line, expanded:

```json
{
  "run_id": "6f1c2a",
  "seq": 1832,
  "t_ms": 5123456,
  "rssi": -66,
  "raw": "9e4e1cffff1e010101019e5503c089460103",
  "magic": 158,
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
| `rssi` | Signal strength at the base, in dBm, of the **last hop**, not of the origin node |
| `raw` | Manufacturer data as received (after the company ID), lowercase hex. Goes into `packets.raw` |
| `magic` … `type` | Header fields, as in [Input](#input-serranet-packets). `type` is `"ALERT"` or `"HEARTBEAT"` |
| `hops` | `TTL_INITIAL - ttl` |
| `alert` | Present only when `type` is `"ALERT"` |

The example is a real encoding: node `7246` (`0x1C4E`), `msg_id` 286, three hops out, a whistle at 62% confidence, 85.3 dB, three blasts. It should be the first entry in `tests/vectors.json`.

**Resuming:** the server keeps the last 1,000 events. A client that reconnects with `Last-Event-ID` gets what it missed, as long as it's still buffered. If the `run_id` in that ID no longer matches, the client gets the whole buffer. Browsers' `EventSource` sends `Last-Event-ID` automatically.

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
  "magic": 158,
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

`scanner` is `up`, `starting` or `down` (Bluetooth off or adapter missing). `adverts` counts every advertisement under company `0xFFFF`; `packets` counts what went out on `/events`.

---

## Running it

Planned commands, from `base-station/`. Run `uv sync` once first.

| Where | Command | For |
|---|---|---|
| Laptop | `uv run serra-base --source sim` | Building `app/` with no Pi and no Picos: fake alerts and heartbeats from the `seed.sql` nodes |
| Laptop | `uv run serra-base --source replay captures/sample.ndjson` | Replaying a recorded session, timing included |
| Pi | `uv run serra-base --source ble --record captures/demo.ndjson` | The real thing (the systemd unit runs this) |
| Laptop | `uv run serra-base --source ble` | Stage fallback if the Pi fails. Point the ingest at `http://localhost:8080` |

| Option | Default | |
|---|---|---|
| `--source` | `ble` | `ble`, `sim` or `replay <file>` |
| `--host` | `0.0.0.0` | Listen address |
| `--port` | `8080` | Listen port |
| `--record <file>` | off | Append every advertisement under company `0xFFFF`, **before** decoding, as NDJSON: `{"t_ms": ..., "addr": "...", "rssi": -66, "data": "<hex>"}` |

---

## Pi setup (once)

Do this **before the event, with internet**. In gadget mode the Pi has no internet, so dependencies have to be installed beforehand.

1. **Flash** Raspberry Pi OS Trixie (64-bit). Images dated 2025-10-20 or later ship `rpi-usb-gadget`; on older ones, `sudo apt install rpi-usb-gadget`.
2. **Get the code onto the Pi** over Wi-Fi: clone the repo, install uv, then run `uv sync` in `base-station/`.
3. **Turn on gadget mode:** `sudo rpi-usb-gadget on`, then reboot.
4. **Install the service:** `sudo deploy/setup-pi.sh` installs `serra-base.service` and enables it, so the decoder starts on boot and restarts if it crashes.
5. **Connect** the Pi's USB-C port to the laptop (through a powered hub, see below), wait for it to boot, then from the laptop:
   ```bash
   ssh <user>@10.12.194.1
   curl http://10.12.194.1:8080/health
   ```

**Power:** in gadget mode the Pi 5 is powered through the same USB-C cable that carries the data, and laptop ports often can't supply enough. Raspberry Pi recommends a powered USB hub between the laptop and the Pi. On the Pi, `vcgencmd get_throttled` should print `throttled=0x0`; anything else means undervoltage or throttling.

---

## Gotchas

- **The Pi's clock is wrong.** In gadget mode the Pi has no internet, so no NTP, and the Pi 5's real-time clock only keeps time with a battery fitted. Events therefore carry `t_ms` (Pi monotonic time) for grouping, and the laptop stamps wall-clock time. Never compare a Pi timestamp with a laptop timestamp.
- **BlueZ reports changes, not every advertisement.** On Linux, bleak goes through BlueZ, which reports when a device's advertising data changes rather than every advertisement. Each new Serranet packet changes the bytes, so floods get through, and a node repeating identical bytes gives one callback, which dedup would drop anyway. Test it early: advertise changing manufacturer data under `0xFFFF` from nRF Connect on a phone and watch `/events`.
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

- [ ] Pin `MAGIC`, the type IDs and `TTL_INITIAL` with firmware, in `protocol.py` and the firmware mesh header at the same time.
- [ ] Define the `HEARTBEAT` payload. The Supabase schema expects battery percentage and millivolts from it.
- [ ] `app/supabase/seed.sql` stores `peak_level` 3100 for 62 dB. On the wire `peak_level` is tenths of a dB, so 62 dB is 620.
- [ ] Test BlueZ delivery with nRF Connect (see [Gotchas](#gotchas)).
- [ ] Check the Pi 5's power over the laptop's USB-C, with and without a powered hub.
- [ ] Update the root README (decision 8, the Base station section, the repository layout) and CONTRIBUTING's layout table: the dashboard now runs on the laptop, and the Pi talks to it over USB.
