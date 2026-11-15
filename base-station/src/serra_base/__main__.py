"""serra-base CLI: scan (or simulate) the Serranet, decode, dedup, serve JSON events.

Events are served over HTTP (``GET /events`` as SSE, ``GET /health``) and also printed to
stdout as NDJSON, one per unique packet; status and counters go to stderr.
"""

import argparse
import asyncio
import contextlib
import json
import os
import secrets
import sys

from serra_base import protocol, server
from serra_base.dedup import Dedup
from serra_base.events import to_event
from serra_base.recorder import Recorder
from serra_base.server import EventHub, Status
from serra_base.sources import Source

COUNTERS = ("adverts", "packets", "duplicates", "bad_magic", "too_short", "unknown_type")
STATS_INTERVAL_S = 10.0
# After the source fails (Bluetooth off, adapter unplugged), wait this long and reopen it.
# The server, run_id, seq and dedup stay up meanwhile, and /health reports scanner "down".
RETRY_S = 5.0


def _int(s: str) -> int:
    return int(s, 0)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="serra-base", description=__doc__)
    p.add_argument("--source", choices=("ble", "sim"), default="ble")
    p.add_argument(
        "--magic", type=_int, default=protocol.MAGIC, help="magic byte (default 0x%(default)02x)"
    )
    p.add_argument(
        "--company-id", type=_int, default=protocol.COMPANY_ID, help="BLE company ID (ble only)"
    )
    p.add_argument("-v", "--verbose", action="store_true", help="log dropped adverts to stderr")
    p.add_argument("--record", metavar="FILE", help="append raw adverts to an NDJSON capture")
    p.add_argument("--seed", type=int, help="random seed (sim only)")
    p.add_argument("--interval", type=float, default=2.0, help="seconds between alerts (sim only)")
    p.add_argument("--host", default="0.0.0.0", help="listen address (default %(default)s)")
    p.add_argument("--port", type=int, default=8080, help="listen port (default %(default)s)")
    args = p.parse_args(argv)
    if not 0 <= args.magic <= 0xFF:
        p.error("--magic must fit in one byte")
    if not 0 <= args.port <= 0xFFFF:
        p.error("--port must be 0-65535")
    return args


def _log(msg: str) -> None:
    print(f"serra-base: {msg}", file=sys.stderr, flush=True)


def _counts_line(counts: dict[str, int]) -> str:
    return " ".join(f"{k}={v}" for k, v in counts.items())


async def _print_stats(counts: dict[str, int]) -> None:
    while True:
        await asyncio.sleep(STATS_INTERVAL_S)
        _log(_counts_line(counts))


def _open_source(
    args: argparse.Namespace, status: Status
) -> tuple[Source, tuple[type[BaseException], ...]]:
    """Return the source and the exceptions that mean it failed (e.g. no Bluetooth)."""
    if args.source == "sim":
        from serra_base.sources import sim

        status.scanner = "up"
        return sim.run(magic=args.magic, seed=args.seed, interval_s=args.interval), ()

    from bleak.exc import BleakError

    from serra_base.sources import ble

    def on_state(state: str) -> None:
        status.scanner = state

    return ble.scan(company_id=args.company_id, on_state=on_state), (BleakError, OSError)


async def _run(args: argparse.Namespace, status: Status, recorder: Recorder | None) -> int:
    hub = EventHub(status.run_id)
    try:
        runner = await server.start(hub, status, args.host, args.port)
    except OSError as e:
        _log(f"error: cannot listen on {args.host}:{args.port}: {e.strerror or e}")
        return 2
    _log(f"serving http://{args.host}:{args.port} (/events, /health)")

    counts = status.counts
    dedup = Dedup()
    seq = 0
    stats = asyncio.create_task(_print_stats(counts))
    try:
        while True:
            source, source_errors = _open_source(args, status)
            async with contextlib.aclosing(source):
                while True:
                    # Only the source's own errors mean "source failed"; an OSError from
                    # printing (e.g. BrokenPipeError) must not be mistaken for one.
                    try:
                        adv = await anext(source)
                    except StopAsyncIteration:
                        return 0
                    except source_errors as e:
                        failure = e
                        break

                    counts["adverts"] += 1
                    if recorder is not None:
                        recorder.write(adv)
                    try:
                        pkt = protocol.decode(adv.data, args.magic)
                    except protocol.DecodeError as e:
                        counts[e.reason] += 1
                        if args.verbose:
                            _log(
                                f"drop {e.reason} addr={adv.addr} rssi={adv.rssi} {adv.data.hex()}"
                            )
                        continue
                    if dedup.seen(pkt.src, pkt.msg_id):
                        counts["duplicates"] += 1
                        if args.verbose:
                            _log(
                                f"drop duplicate src=0x{pkt.src:04x} msg_id={pkt.msg_id} "
                                f"ttl={pkt.ttl} addr={adv.addr} rssi={adv.rssi} {adv.data.hex()}"
                            )
                        continue
                    seq += 1
                    counts["packets"] += 1
                    event = to_event(
                        pkt, run_id=status.run_id, seq=seq, t_ms=adv.t_ms, rssi=adv.rssi
                    )
                    line = json.dumps(event, separators=(",", ":"))
                    hub.publish(seq, line)
                    print(line, flush=True)

            status.scanner = "down"
            _log(
                f"error: {args.source} source failed: {failure or type(failure).__name__}; "
                f"retrying in {RETRY_S:g} s"
            )
            await asyncio.sleep(RETRY_S)
    finally:
        stats.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await stats
        hub.close()
        await runner.cleanup()


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    run_id = secrets.token_hex(3)
    counts = dict.fromkeys(COUNTERS, 0)
    status = Status(
        run_id=run_id,
        source=args.source,
        magic=args.magic,
        company_id=args.company_id,
        counts=counts,
    )
    _log(
        f"run_id={run_id} source={args.source} magic=0x{args.magic:02x} "
        f"company_id=0x{args.company_id:04x}"
    )
    # Open the capture before starting, so a bad path is a one-line error, not a traceback.
    try:
        recorder = Recorder(args.record) if args.record else None
    except OSError as e:
        _log(f"error: cannot open --record file: {e}")
        return 2
    try:
        code = asyncio.run(_run(args, status, recorder))
    except KeyboardInterrupt:
        code = 0
    except BrokenPipeError:
        # stdout's reader went away (e.g. `| head`). Point stdout at devnull so the
        # interpreter's final flush doesn't raise again, and stop cleanly.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        code = 0
    finally:
        if recorder is not None:
            recorder.close()
    _log(f"exit {_counts_line(counts)}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
