"""Sources of raw advertisements: BLE radio, simulator, or a recorded capture.

Every source is an async iterator of `Advert`, so the rest of the pipeline can't
tell a real radio from a simulation.
"""

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Advert:
    """One advertisement's manufacturer data under our company ID (company ID stripped)."""

    t_ms: int  # monotonic receive time, ms
    addr: str  # sender's BLE address (or a fake one for sim)
    rssi: int | None
    data: bytes  # starts at the magic byte


def now_ms() -> int:
    """Monotonic milliseconds; only meaningful as differences within one run."""
    return time.monotonic_ns() // 1_000_000


type Source = AsyncIterator[Advert]
