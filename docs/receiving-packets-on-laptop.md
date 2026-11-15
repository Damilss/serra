# Receiving packets on the laptop

How to see decoded Serranet packets on the laptop, from the Pi 5 base station over USB or from a simulation with no hardware. The full event contract is in [`base-station/README.md`](../base-station/README.md#output-event-stream).

```
Serranodes ─BLE─▶ Pi 5 (serra-base) ──USB-C──▶ laptop
                  10.12.194.1:8080              10.12.194.x
                  GET /events (SSE)
                  GET /health
```

## Before you start

- The Pi has been set up once ([Pi setup](../base-station/README.md#pi-setup-once)): gadget mode is on and `serra-base.service` is installed.
- The Pi's USB-C port is connected to the laptop, through a powered hub if the laptop port can't power the Pi.
- Wait for the Pi to boot. The laptop gets a USB Ethernet adapter with an address in `10.12.194.0/28`:

  ```bash
  ifconfig | grep 10.12.194     # macOS: e.g. "inet 10.12.194.5 netmask 0xfffffff0"
  ```

  No address means the link isn't up yet. Check the cable and hub, and that the Pi has finished booting.

## 1. Check the decoder is up

```bash
curl http://10.12.194.1:8080/health
```

Look for `"source": "ble"` and `"scanner": "up"`. `counts.adverts` is everything heard under company ID `0xFFFF`; `counts.packets` is what was decoded and sent out on `/events`.

| You see | It means |
|---|---|
| Connection refused or timeout | Link down, or the service isn't running (see [Troubleshooting](#troubleshooting)) |
| `"scanner": "down"` | Bluetooth is off or the adapter is missing. serra-base retries every 5 s |
| `adverts` goes up, `packets` doesn't | Packets heard but dropped: look at `duplicates`, `bad_magic`, `too_short`, `unknown_type` |
| `bad_magic` goes up | Another device is using test company ID `0xFFFF`, or the firmware's magic byte differs from `0x5E` |

## 2. Watch packets live

```bash
curl -N http://10.12.194.1:8080/events
```

Then trigger a node: whistle, scream or say "help" near it. Each decoded packet prints as one SSE message:

```
id: 6367eb:24
event: packet
data: {"run_id":"6367eb","seq":24,"t_ms":7125567,"rssi":-56,"raw":"5e160bffff81c5040101f7fc03fa2f700002","magic":94,"src":2838,"node_id":2838,"node_hex":"0x0B16","dst":65535,"msg_id":50561,"ttl":4,"hops":0,"type":"ALERT","alert":{"class":"whistle","confidence":0.9686,"peak_level":1020,"peak_db":102.0,"timestamp":7352314,"blast_count":2}}
```

- `node_id` is the node that heard the sound. It matches `nodes.node_id` in Supabase, and a relayed packet (`hops` > 0) still carries the origin's ID. `node_hex` is the same ID as the Pico prints it at boot (`[mesh] node 0x0b16`).
- `-N` turns off curl's buffering. Without it, events show up late or in batches.
- The stream opens with `retry: 2000`. A `: ping` line after 15 s with no events means the connection is alive and nothing new has been decoded.
- Without `Last-Event-ID`, you get **live events only**, nothing from before you connected.

To print only the JSON:

```bash
curl -sN http://10.12.194.1:8080/events | sed -n 's/^data: //p'
```

Add `| jq .` to pretty-print, or `| jq -c '{node_hex, hops, class: .alert.class, peak_db: .alert.peak_db, rssi}'` for one short line per packet.

## 3. See packets from before you connected

The Pi keeps its last 1,000 events. Send a `Last-Event-ID` from a different run and you get the whole buffer, then the live stream:

```bash
curl -N -H 'Last-Event-ID: none:0' http://10.12.194.1:8080/events
```

To pick up after a packet you already have, send that packet's `id:` instead, e.g. `-H 'Last-Event-ID: 6367eb:24'`.

## 4. Watch the Pi's log

```bash
ssh <user>@10.12.194.1 journalctl -u serra-base -f
```

Shows the counters, the scanner going up or down, and errors. The service also records every raw advertisement to `base-station/captures/live.ndjson` on the Pi.

## Without the Pi

Run the decoder on the laptop with simulated nodes (`0x1C4E`, `0x2A10`, `0x3B7F`):

```bash
cd base-station
uv sync                              # once
uv run serra-base --source sim       # in one terminal
curl -N localhost:8080/events        # in another
```

The simulator sends an alert every 2 s (`--interval`), each heard over 2–4 paths, with an occasional heartbeat or bad-magic advert. `--seed 42` makes it repeatable.

**Stage fallback:** if the Pi fails, `uv run serra-base --source ble` scans with the laptop's own Bluetooth (bleak works on macOS). Point everything at `http://localhost:8080` instead of `10.12.194.1`.

## Troubleshooting

| Problem | Try |
|---|---|
| No `10.12.194.x` address on the laptop | Reconnect the cable, use a powered hub, wait for the boot to finish. On the Pi, `vcgencmd get_throttled` should print `throttled=0x0` |
| Link up, but `curl` is refused | The service isn't running: `ssh <user>@10.12.194.1 sudo systemctl status serra-base` |
| Running `serra-base` by hand on the Pi exits with code 2 | The service already has port 8080: `sudo systemctl stop serra-base` first, `start` it again after |
| `/health` works but no new events | Check that a node is powered and in range, and watch `adverts` in `/health` while you trigger it |
| One event, then nothing while the node keeps advertising | Expected: the same bytes from the same sender are one packet. A new event needs a new `msg_id` |
| `"source": "sim"` when you expected the Pi | Something is answering on `localhost`. Use `10.12.194.1` for the Pi |

## Verified

2026-11-14: Pi connected over USB (laptop at `10.12.194.5`), `serra-base` 0.2.0 with `source: ble`. `/health` reported 32 adverts, 26 packets and 6 duplicates. The buffered stream returned real alerts from node `2838` (`0x0B16`): whistles and a scream around 100 dB, 0 hops, RSSI about −58 dBm. No new packets arrived during a 20 s live watch. A later read of the buffer showed three nodes: `0x0B16` (2838), `0x2D9A` (11674) and `0xED70` (60784), each mostly heard directly, with a few 1-hop relays. That run predates `node_id` and `node_hex`, so its events carry the ID in `src` only.
