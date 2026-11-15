"""serra-base CLI: scan (or simulate) the Serranet, decode, dedup, print JSON events.

Events go to stdout as NDJSON, one per unique packet; status and counters go to stderr.
"""

import argparse
import asyncio
import contextlib
import json
import os
import secrets
import sys

from serra_base import protocol
from serra_base.dedup import Dedup
from serra_base.events import to_event
from serra_base.recorder import Recorder
from serra_base.sources import Source

COUNTERS = ("adverts", "packets", "duplicates", "bad_magic", "too_short", "unknown_type")
STATS_INTERVAL_S = 10.0


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
    args = p.parse_args(argv)
    if not 0 <= args.magic <= 0xFF:
        p.error("--magic must fit in one byte")
    return args


def _log(msg: str) -> None:
    print(f"serra-base: {msg}", file=sys.stderr, flush=True)


def _counts_line(counts: dict[str, int]) -> str:
    return " ".join(f"{k}={v}" for k, v in counts.items())


async def _print_stats(counts: dict[str, int]) -> None:
    while True:
        await asyncio.sleep(STATS_INTERVAL_S)
        _log(_counts_line(counts))


def _open_source(args: argparse.Namespace) -> tuple[Source, tuple[type[BaseException], ...]]:
    """Return the source and the exceptions that mean it failed (e.g. no Bluetooth)."""
    if args.source == "sim":
        from serra_base.sources import sim

        return sim.run(magic=args.magic, seed=args.seed, interval_s=args.interval), ()

    from bleak.exc import BleakError

    from serra_base.sources import ble

    return ble.scan(company_id=args.company_id), (BleakError, OSError)


async def _run(
    args: argparse.Namespace, run_id: str, counts: dict[str, int], recorder: Recorder | None
) -> int:
    source, source_errors = _open_source(args)
    dedup = Dedup()
    seq = 0
    stats = asyncio.create_task(_print_stats(counts))
    try:
        async with contextlib.aclosing(source):
            while True:
                try:
                    adv = await anext(source)
                except StopAsyncIteration:
                    return 0
                except source_errors as e:
                    _log(f"error: {args.source} source failed: {e or type(e).__name__}")
                    return 1

                counts["adverts"] += 1
                if recorder is not None:
                    recorder.write(adv)
                try:
                    pkt = protocol.decode(adv.data, args.magic)
                except protocol.DecodeError as e:
                    counts[e.reason] += 1
                    if args.verbose:
                        _log(f"drop {e.reason} addr={adv.addr} rssi={adv.rssi} {adv.data.hex()}")
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
                event = to_event(pkt, run_id=run_id, seq=seq, t_ms=adv.t_ms, rssi=adv.rssi)
                print(json.dumps(event, separators=(",", ":")), flush=True)
    finally:
        stats.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await stats


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    run_id = secrets.token_hex(3)
    counts = dict.fromkeys(COUNTERS, 0)
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
        code = asyncio.run(_run(args, run_id, counts, recorder))
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
