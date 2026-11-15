"""Live BLE source: bleak scanner keeping manufacturer data under our company ID."""

import asyncio
import sys
import time
from collections.abc import AsyncIterator, Callable

from bleak import BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData

from serra_base.protocol import COMPANY_ID
from serra_base.sources import Advert, now_ms

QUEUE_MAX = 1000
# With no callback from any device for this long, restart the scan. If Bluetooth has gone
# away (adapter powered off or unplugged, bluetoothd restarted, macOS Bluetooth toggled
# off), the restart raises BleakError, so the caller exits and systemd restarts us.
# Neither bleak backend reports that on its own: the scan just goes silent.
SILENCE_S = 30.0
# RSSI values bleak passes through that mean "no reading": BlueZ's default when the
# property is missing (-127) and CoreBluetooth's "not available" (127).
RSSI_MIN, RSSI_MAX = -127, 127
# An identical repeat from one address is passed on at most this often. Each one reaches
# Dedup.seen() and refreshes its entry, so a packet that stays on air never expires from
# dedup and a later relay copy of it is still dropped. Must stay well under Dedup's
# window (60 s).
REPEAT_REFRESH_S = 10.0


class RepeatFilter:
    """Throttles byte-identical repeats from the same address to one per `refresh_s`."""

    def __init__(
        self, refresh_s: float = REPEAT_REFRESH_S, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.refresh_s = refresh_s
        self._clock = clock
        self._last: dict[str, tuple[bytes, float]] = {}  # addr -> (data, when passed on)

    def is_repeat(self, addr: str, data: bytes) -> bool:
        """True if `addr` sent these bytes and they were passed on under `refresh_s` ago."""
        last = self._last.get(addr)
        return last is not None and last[0] == data and self._clock() - last[1] < self.refresh_s

    def record(self, addr: str, data: bytes) -> None:
        """Note that these bytes from `addr` were passed on now."""
        self._last[addr] = (bytes(data), self._clock())


async def scan(
    company_id: int = COMPANY_ID, on_state: Callable[[str], None] = lambda state: None
) -> AsyncIterator[Advert]:
    """Yield each new advertisement carrying manufacturer data under `company_id`.

    `on_state` hears "starting" while the scanner (re)starts and "up" once it runs, for
    /health. A failure raises (BleakError, OSError); the caller reports it as "down".

    Repeats of the last bytes from the same address are passed on at most every
    REPEAT_REFRESH_S, enough to keep dedup refreshed. Backends report the same
    advertisement more than once: on Linux, bleak calls back on every BlueZ property change
    (an RSSI update included) with the cached manufacturer data, and CoreBluetooth may
    report every advertisement. Identical bytes from one sender are the same packet, so
    nothing is lost; each new Serranet packet has a new msg_id or ttl.
    """
    queue: asyncio.Queue[Advert] = asyncio.Queue(maxsize=QUEUE_MAX)
    repeats = RepeatFilter(clock=time.monotonic)
    heard = time.monotonic()  # last callback from any device, ours or not
    warned = False

    def on_advert(device: BLEDevice, adv: AdvertisementData) -> None:
        # Runs on the event loop; must never block.
        nonlocal heard, warned
        heard = time.monotonic()
        data = adv.manufacturer_data.get(company_id)
        if data is None or repeats.is_repeat(device.address, data):
            return
        rssi = adv.rssi if RSSI_MIN < adv.rssi < RSSI_MAX else None
        try:
            queue.put_nowait(Advert(now_ms(), device.address, rssi, bytes(data)))
        except asyncio.QueueFull:
            if not warned:
                print("serra-base: advert queue full, dropping adverts", file=sys.stderr)
                warned = True
            return
        repeats.record(device.address, data)

    on_state("starting")
    async with BleakScanner(detection_callback=on_advert) as scanner:  # active by default
        on_state("up")
        while True:
            try:
                adv = await asyncio.wait_for(queue.get(), timeout=SILENCE_S)
            except TimeoutError:
                if time.monotonic() - heard >= SILENCE_S:
                    # A healthy adapter restarts and BlueZ re-reports nearby devices; a
                    # missing or powered-off one raises BleakError here.
                    on_state("starting")
                    await scanner.stop()
                    await scanner.start()
                    on_state("up")
                    heard = time.monotonic()
                continue
            yield adv
