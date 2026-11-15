"""HTTP side of serra-base: ``GET /events`` (Server-Sent Events) and ``GET /health``.

The laptop's ingest (and, for debugging, a browser or ``curl -N``) holds ``/events`` open
and gets one SSE message per deduplicated packet. Every message has the ID
``<run_id>:<seq>``. A client that reconnects sends the last ID it saw in ``Last-Event-ID``
and gets what it missed from a buffer of the last 1,000 events. If the ``run_id`` no
longer matches (serra-base restarted, so ``seq`` restarted too), it gets the whole buffer.
A client with no ``Last-Event-ID`` gets live events only.

Everything runs on the same asyncio loop as the scanner, so nothing here may block: a
client that can't keep up is disconnected instead of being waited for. It reconnects and
catches up from the buffer.
"""

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field

from aiohttp import web

from serra_base import __version__

BUFFER_SIZE = 1000
CLIENT_QUEUE_MAX = 256  # frames a client may fall behind before it's disconnected
PING_S = 15.0  # comment line sent on an idle stream, so dead connections are noticed
RETRY_MS = 2000  # reconnect delay suggested to EventSource clients
CORS = {"Access-Control-Allow-Origin": "*"}  # the dashboard runs on another origin

type Frame = bytes | None  # None tells a client's handler to end the stream


@dataclass
class Status:
    """What ``/health`` reports. ``counts`` is the pipeline's live counters dict."""

    run_id: str
    source: str
    magic: int
    company_id: int
    counts: dict[str, int]
    scanner: str = "starting"  # starting | up | down
    started: float = field(default_factory=time.monotonic)


class EventHub:
    """The resume buffer plus one bounded queue per connected ``/events`` client."""

    def __init__(
        self, run_id: str, buffer_size: int = BUFFER_SIZE, client_queue: int = CLIENT_QUEUE_MAX
    ) -> None:
        self.run_id = run_id
        self._buffer: deque[tuple[int, bytes]] = deque(maxlen=buffer_size)
        self._client_queue = client_queue
        self._clients: set[asyncio.Queue[Frame]] = set()
        self._closed = False

    @property
    def clients(self) -> int:
        return len(self._clients)

    def publish(self, seq: int, data: str) -> None:
        """Buffer one event (``data`` is its JSON) and send it to every client."""
        frame = f"id: {self.run_id}:{seq}\nevent: packet\ndata: {data}\n\n".encode()
        self._buffer.append((seq, frame))
        for q in list(self._clients):
            try:
                q.put_nowait(frame)
            except asyncio.QueueFull:
                self._disconnect(q)

    def subscribe(self, last_event_id: str | None) -> tuple[list[bytes], asyncio.Queue[Frame]]:
        """Return the frames this client missed, and its queue for live frames.

        Both come from the same moment (no await in between), so no event is lost or
        sent twice between the backlog and the live stream.
        """
        q: asyncio.Queue[Frame] = asyncio.Queue(maxsize=self._client_queue)
        if self._closed:
            q.put_nowait(None)
            return [], q
        self._clients.add(q)
        return self._backlog(last_event_id), q

    def unsubscribe(self, q: asyncio.Queue[Frame]) -> None:
        self._clients.discard(q)

    def close(self) -> None:
        """End every stream, so their handlers return before the server shuts down."""
        self._closed = True
        for q in list(self._clients):
            self._disconnect(q)

    def _backlog(self, last_event_id: str | None) -> list[bytes]:
        if not last_event_id:
            return []
        run_id, _, seq = last_event_id.strip().rpartition(":")
        if run_id == self.run_id and seq.isdigit():
            last = int(seq)
            return [frame for s, frame in self._buffer if s > last]
        return [frame for _, frame in self._buffer]

    def _disconnect(self, q: asyncio.Queue[Frame]) -> None:
        self._clients.discard(q)
        while not q.empty():  # make room for the sentinel; this client is going away
            q.get_nowait()
        q.put_nowait(None)


HUB = web.AppKey("hub", EventHub)
STATUS = web.AppKey("status", Status)


async def _events(request: web.Request) -> web.StreamResponse:
    hub = request.app[HUB]
    backlog, q = hub.subscribe(request.headers.get("Last-Event-ID"))
    resp = web.StreamResponse(
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            **CORS,
        }
    )
    try:
        await resp.prepare(request)
        await resp.write(f"retry: {RETRY_MS}\n\n".encode())
        for frame in backlog:
            await resp.write(frame)
        while True:
            try:
                frame = await asyncio.wait_for(q.get(), PING_S)
            except TimeoutError:
                frame = b": ping\n\n"
            if frame is None:
                break
            await resp.write(frame)
    except ConnectionResetError:
        pass  # the client went away
    finally:
        hub.unsubscribe(q)
    return resp


async def _health(request: web.Request) -> web.Response:
    s = request.app[STATUS]
    body = {
        "version": __version__,
        "run_id": s.run_id,
        "source": s.source,
        "scanner": s.scanner,
        "company_id": s.company_id,
        "magic": s.magic,
        "uptime_s": int(time.monotonic() - s.started),
        "clients": request.app[HUB].clients,
        "counts": dict(s.counts),
    }
    return web.json_response(body, headers=CORS)


def make_app(hub: EventHub, status: Status) -> web.Application:
    app = web.Application()
    app[HUB] = hub
    app[STATUS] = status
    app.router.add_get("/events", _events)
    app.router.add_get("/health", _health)
    return app


async def start(hub: EventHub, status: Status, host: str, port: int) -> web.AppRunner:
    """Start serving. Raises OSError if the address can't be bound (e.g. port in use)."""
    runner = web.AppRunner(
        make_app(hub, status), access_log=None, handle_signals=False, shutdown_timeout=2.0
    )
    await runner.setup()
    try:
        await web.TCPSite(runner, host, port).start()
    except BaseException:
        await runner.cleanup()
        raise
    return runner
