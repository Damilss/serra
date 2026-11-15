"""CLI pipeline: the source-failure retry keeps the run (server, run_id, seq) alive."""

import asyncio
import json

from serra_base import __main__ as cli
from serra_base import protocol
from serra_base.server import Status
from serra_base.sources import Advert


def _advert(msg_id: int) -> Advert:
    data = protocol.encode_alert(
        src=0x1C4E,
        msg_id=msg_id,
        ttl=4,
        class_id=protocol.CLASS_WHISTLE,
        confidence=158,
        peak_level=853,
        timestamp=21400000,
        blast_count=3,
    )
    return Advert(t_ms=msg_id, addr="AA:AA", rssi=-60, data=data)


def test_source_failure_retries_without_ending_the_run(monkeypatch, capsys):
    # First source yields one packet and then fails like a lost adapter; the second yields
    # one more and ends. The run must carry on: same run_id, seq continues, scanner "down"
    # while it waits, exit 0 at the end.
    seen_states: list[str] = []
    opened = 0

    async def first():
        yield _advert(1)
        raise OSError("adapter gone")

    async def second(status: Status):
        seen_states.append(status.scanner)
        status.scanner = "up"
        yield _advert(2)

    def fake_open(args, status):
        nonlocal opened
        opened += 1
        return (first() if opened == 1 else second(status)), (OSError,)

    monkeypatch.setattr(cli, "_open_source", fake_open)
    monkeypatch.setattr(cli, "RETRY_S", 0.0)

    args = cli._parse_args(["--source", "ble", "--host", "127.0.0.1", "--port", "0"])
    counts = dict.fromkeys(cli.COUNTERS, 0)
    status = Status(run_id="r00001", source="ble", magic=0x5E, company_id=0xFFFF, counts=counts)

    code = asyncio.run(cli._run(args, status, recorder=None))

    out = capsys.readouterr()
    events = [json.loads(line) for line in out.out.splitlines()]
    assert code == 0
    assert opened == 2
    assert seen_states == ["down"]
    assert [(e["run_id"], e["seq"], e["msg_id"]) for e in events] == [
        ("r00001", 1, 1),
        ("r00001", 2, 2),
    ]
    assert counts["packets"] == 2
    assert "source failed: adapter gone; retrying" in out.err


def test_bad_port_is_a_usage_error(capsys):
    try:
        cli._parse_args(["--port", "70000"])
    except SystemExit as e:
        assert e.code == 2
    assert "--port must be 0-65535" in capsys.readouterr().err
