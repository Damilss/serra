"""Live BLE source: bleak scanner keeping manufacturer data under our company ID."""

import asyncio
import sys
import time
from collections.abc import AsyncIterator

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


async def scan(company_id: int = COMPANY_ID) -> AsyncIterator[Advert]:
    """Yield each new advertisement carrying manufacturer data under `company_id`.

    Repeats of the last bytes from the same address are skipped. Backends report the same
    advertisement more than once: on Linux, bleak calls back on every BlueZ property change
    (an RSSI update included) with the cached manufacturer data, and CoreBluetooth may
    report every advertisement. Identical bytes from one sender are the same packet, so
    nothing is lost; each new Serranet packet has a new msg_id or ttl.
    """
    queue: asyncio.Queue[Advert] = asyncio.Queue(maxsize=QUEUE_MAX)
    last: dict[str, bytes] = {}  # last data per address
    heard = time.monotonic()  # last callback from any device, ours or not
    warned = False

    def on_advert(device: BLEDevice, adv: AdvertisementData) -> None:
        # Runs on the event loop; must never block.
        nonlocal heard, warned
        heard = time.monotonic()
        data = adv.manufacturer_data.get(company_id)
        if data is None or last.get(device.address) == data:
            return
        rssi = adv.rssi if RSSI_MIN < adv.rssi < RSSI_MAX else None
        try:
            queue.put_nowait(Advert(now_ms(), device.address, rssi, bytes(data)))
        except asyncio.QueueFull:
            if not warned:
                print("serra-base: advert queue full, dropping adverts", file=sys.stderr)
                warned = True
            return
        last[device.address] = bytes(data)

    async with BleakScanner(detection_callback=on_advert) as scanner:  # active by default
        while True:
            try:
                adv = await asyncio.wait_for(queue.get(), timeout=SILENCE_S)
            except TimeoutError:
                if time.monotonic() - heard >= SILENCE_S:
                    # A healthy adapter restarts and BlueZ re-reports nearby devices; a
                    # missing or powered-off one raises BleakError here.
                    await scanner.stop()
                    await scanner.start()
                    heard = time.monotonic()
                continue
            yield adv
