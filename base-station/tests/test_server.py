"""HTTP side: /events (SSE framing, resume, slow clients) and /health. No network needed."""

import asyncio
import json

from aiohttp.test_utils import TestClient, TestServer

from serra_base import __version__, server
from serra_base.server import EventHub, Status

RUN = "abc123"


def _status(**kw) -> Status:
    counts = {"adverts": 3, "packets": 1, "duplicates": 2}
    return Status(run_id=RUN, source="sim", magic=0x5E, company_id=0xFFFF, counts=counts, **kw)


def _event(seq: int) -> str:
    return json.dumps({"run_id": RUN, "seq": seq}, separators=(",", ":"))


def _seqs(frames: list[bytes]) -> list[int]:
    return [int(f.split(b"\n", 1)[0].rsplit(b":", 1)[1]) for f in frames]


def _serve(test, hub: EventHub | None = None, status: Status | None = None):
    """Run `test(client, hub, status)` against an in-process server."""
    hub = hub or EventHub(RUN)
    status = status or _status()

    async def go():
        async with TestClient(TestServer(server.make_app(hub, status))) as client:
            return await test(client, hub, status)

    return asyncio.run(go())


async def _read_frames(resp, n: int) -> list[str]:
    """Read `n` SSE messages (blank-line separated) from a streaming response."""
    frames, cur = [], []
    while len(frames) < n:
        line = (await asyncio.wait_for(resp.content.readline(), 1.0)).decode()
        if line == "\n":
            frames.append("".join(cur))
            cur = []
        else:
            cur.append(line)
    return frames


# ── EventHub ──


def test_frame_format():
    hub = EventHub(RUN)
    hub.publish(7, _event(7))
    (frame,) = hub.subscribe("other:0")[0]
    assert frame == f"id: {RUN}:7\nevent: packet\ndata: {_event(7)}\n\n".encode()


def test_backlog_same_run_gets_only_missed():
    hub = EventHub(RUN)
    for seq in range(1, 11):
        hub.publish(seq, _event(seq))
    assert _seqs(hub.subscribe(f"{RUN}:7")[0]) == [8, 9, 10]
    assert hub.subscribe(f"{RUN}:10")[0] == []


def test_backlog_other_run_or_garbage_gets_whole_buffer():
    hub = EventHub(RUN)
    for seq in range(1, 4):
        hub.publish(seq, _event(seq))
    assert _seqs(hub.subscribe("deadbe:2")[0]) == [1, 2, 3]
    assert _seqs(hub.subscribe("nonsense")[0]) == [1, 2, 3]
    assert _seqs(hub.subscribe(f"{RUN}:x")[0]) == [1, 2, 3]


def test_no_last_event_id_is_live_only():
    hub = EventHub(RUN)
    hub.publish(1, _event(1))
    backlog, q = hub.subscribe(None)
    assert backlog == []
    hub.publish(2, _event(2))
    assert _seqs([q.get_nowait()]) == [2]


def test_buffer_keeps_last_1000():
    hub = EventHub(RUN)
    for seq in range(1, 1201):
        hub.publish(seq, _event(seq))
    backlog = hub.subscribe("deadbe:1")[0]
    assert len(backlog) == server.BUFFER_SIZE == 1000
    assert _seqs(backlog)[0] == 201
    # Same run but older than the buffer: everything still buffered.
    assert _seqs(hub.subscribe(f"{RUN}:5")[0])[0] == 201


def test_slow_client_is_disconnected_not_waited_for():
    hub = EventHub(RUN, client_queue=3)
    _, slow = hub.subscribe(None)
    _, fast = hub.subscribe(None)
    for seq in range(1, 4):
        hub.publish(seq, _event(seq))
        fast.get_nowait()
    assert hub.clients == 2
    hub.publish(4, _event(4))  # slow's queue is full: it's dropped, publish doesn't block
    assert hub.clients == 1
    assert slow.get_nowait() is None
    assert _seqs([fast.get_nowait()]) == [4]


def test_close_ends_every_stream():
    hub = EventHub(RUN)
    _, q = hub.subscribe(None)
    hub.close()
    assert q.get_nowait() is None
    assert hub.clients == 0
    _, late = hub.subscribe(None)
    assert late.get_nowait() is None


# ── HTTP ──


def test_health():
    async def test(client, hub, status):
        status.scanner = "up"
        status.counts["packets"] = 5
        resp = await client.get("/health")
        assert resp.status == 200
        assert resp.headers["Access-Control-Allow-Origin"] == "*"
        return await resp.json()

    body = _serve(test)
    assert body == {
        "version": __version__,
        "run_id": RUN,
        "source": "sim",
        "scanner": "up",
        "company_id": 65535,
        "magic": 94,
        "uptime_s": 0,
        "clients": 0,
        "counts": {"adverts": 3, "packets": 5, "duplicates": 2},
    }


def test_events_stream_and_client_count():
    async def test(client, hub, status):
        resp = await client.get("/events")
        assert resp.headers["Content-Type"] == "text/event-stream"
        assert resp.headers["Cache-Control"] == "no-cache"
        assert resp.headers["Access-Control-Allow-Origin"] == "*"
        (retry,) = await _read_frames(resp, 1)
        assert retry == f"retry: {server.RETRY_MS}\n"
        assert (await (await client.get("/health")).json())["clients"] == 1

        hub.publish(1, _event(1))
        (frame,) = await _read_frames(resp, 1)
        assert frame == f"id: {RUN}:1\nevent: packet\ndata: {_event(1)}\n"

        resp.close()
        for _ in range(100):
            if hub.clients == 0:
                break
            await asyncio.sleep(0.01)
        return hub.clients

    assert _serve(test) == 0


def test_events_resume_with_last_event_id():
    async def test(client, hub, status):
        for seq in range(1, 6):
            hub.publish(seq, _event(seq))
        resp = await client.get("/events", headers={"Last-Event-ID": f"{RUN}:3"})
        frames = await _read_frames(resp, 3)  # retry, then 4 and 5
        hub.publish(6, _event(6))
        frames += await _read_frames(resp, 1)
        resp.close()
        return frames

    frames = _serve(test)
    assert frames[0].startswith("retry:")
    assert [f.split("\n")[0] for f in frames[1:]] == [f"id: {RUN}:{s}" for s in (4, 5, 6)]


def test_events_ping_when_idle(monkeypatch):
    monkeypatch.setattr(server, "PING_S", 0.05)

    async def test(client, hub, status):
        resp = await client.get("/events")
        frames = await _read_frames(resp, 2)
        resp.close()
        return frames

    assert _serve(test)[1] == ": ping\n"


def test_events_end_on_close():
    async def test(client, hub, status):
        resp = await client.get("/events")
        await _read_frames(resp, 1)
        hub.close()
        rest = await asyncio.wait_for(resp.content.read(), 1.0)
        return rest

    assert _serve(test) == b""


def test_start_reports_port_in_use():
    async def go():
        hub, status = EventHub(RUN), _status()
        runner = await server.start(hub, status, "127.0.0.1", 0)
        port = runner.addresses[0][1]
        try:
            await server.start(hub, status, "127.0.0.1", port)
        except OSError:
            return True
        finally:
            await runner.cleanup()
        return False

    assert asyncio.run(go())
