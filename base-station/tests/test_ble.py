"""BLE source tests with a fake scanner: no Bluetooth adapter needed."""

import asyncio
from types import SimpleNamespace

from serra_base import protocol
from serra_base.dedup import Dedup
from serra_base.sources import ble


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class FakeScanner:
    """Stands in for BleakScanner; the test calls its detection callback directly."""

    instance: "FakeScanner | None" = None

    def __init__(self, detection_callback) -> None:
        self.callback = detection_callback
        FakeScanner.instance = self

    async def __aenter__(self) -> "FakeScanner":
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass


def _alert(ttl: int) -> bytes:
    return protocol.encode_alert(
        src=0x1C4E,
        msg_id=286,
        ttl=ttl,
        class_id=protocol.CLASS_WHISTLE,
        confidence=158,
        peak_level=853,
        timestamp=21400000,
        blast_count=3,
    )


def _scan_script(monkeypatch, script: list[tuple[float, str, bytes]]) -> list[ble.Advert]:
    """Feed (t_s, addr, data) callbacks to ble.scan() on a fake clock; return what it yields."""
    clock = FakeClock()
    FakeScanner.instance = None
    monkeypatch.setattr(ble, "BleakScanner", FakeScanner)
    # Patch the clock ble.py sees, not time.monotonic itself (asyncio's loop uses that).
    monkeypatch.setattr(ble, "time", SimpleNamespace(monotonic=clock))
    monkeypatch.setattr(ble, "now_ms", lambda: round(clock.now * 1000))

    async def drive() -> list[ble.Advert]:
        gen = ble.scan()
        first = asyncio.ensure_future(anext(gen))
        while FakeScanner.instance is None:
            await asyncio.sleep(0)
        for t_s, addr, data in script:
            clock.now = t_s
            FakeScanner.instance.callback(
                SimpleNamespace(address=addr),
                SimpleNamespace(manufacturer_data={protocol.COMPANY_ID: data}, rssi=-60),
            )
        out = [await asyncio.wait_for(first, 1.0)]
        while True:
            try:
                out.append(await asyncio.wait_for(anext(gen), 0.2))
            except TimeoutError:
                break
        await gen.aclose()
        return out

    return asyncio.run(drive())


def _emitted(adverts: list[ble.Advert]) -> list[protocol.Packet]:
    """Decode and dedup like __main__._run(), on each advert's own receive time."""
    clock = FakeClock()
    dedup = Dedup(clock=clock)
    out = []
    for adv in adverts:
        clock.now = adv.t_ms / 1000
        pkt = protocol.decode(adv.data)
        if not dedup.seen(pkt.src, pkt.msg_id):
            out.append(pkt)
    return out


def test_packet_kept_on_air_stays_deduped_through_relay(monkeypatch):
    # A node advertises one alert for 90 s; BlueZ calls back every second with the same
    # bytes. Then a relay rebroadcasts it (ttl - 1). Continuous reception must keep the
    # dedup entry alive, so the relay copy is a duplicate, not a second alert.
    script = [(float(t), "AA:AA", _alert(ttl=4)) for t in range(90)]
    script.append((90.0, "BB:BB", _alert(ttl=3)))

    adverts = _scan_script(monkeypatch, script)
    emitted = _emitted(adverts)

    assert len(emitted) == 1
    assert emitted[0].ttl == 4
    # Identical repeats are still throttled, not passed on every callback.
    from_node = [a for a in adverts if a.addr == "AA:AA"]
    assert len(from_node) == 9  # t = 0, 10, ..., 80


def test_refresh_well_under_dedup_window():
    assert ble.REPEAT_REFRESH_S < Dedup().window_s / 2


def test_repeat_filter_first_bytes_pass():
    f = ble.RepeatFilter(clock=FakeClock())
    assert f.is_repeat("AA", b"x") is False


def test_repeat_filter_throttles_identical_bytes():
    clock = FakeClock()
    f = ble.RepeatFilter(refresh_s=10.0, clock=clock)
    f.record("AA", b"x")
    clock.now = 9.9
    assert f.is_repeat("AA", b"x") is True
    clock.now = 10.0
    assert f.is_repeat("AA", b"x") is False


def test_repeat_filter_changed_bytes_and_other_address_pass():
    f = ble.RepeatFilter(clock=FakeClock())
    f.record("AA", b"x")
    assert f.is_repeat("AA", b"y") is False
    assert f.is_repeat("BB", b"x") is False


def test_repeat_filter_unrecorded_bytes_are_not_repeats():
    # scan() records only once an advert is queued, so a QueueFull drop is retried.
    f = ble.RepeatFilter(clock=FakeClock())
    assert f.is_repeat("AA", b"x") is False
    assert f.is_repeat("AA", b"x") is False


def test_changed_bytes_pass_immediately(monkeypatch):
    script = [
        (0.0, "AA:AA", _alert(ttl=4)),
        (0.5, "AA:AA", _alert(ttl=4)),  # repeat, dropped
        (1.0, "AA:AA", _alert(ttl=3)),  # new bytes, passed
    ]
    adverts = _scan_script(monkeypatch, script)
    assert [a.t_ms for a in adverts] == [0, 1000]
