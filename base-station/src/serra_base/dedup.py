"""Drop repeat copies of the same packet, keyed by ``(src, msg_id)``.

A flooding mesh delivers one alert to the base several times, once per path. The first
copy is kept and later copies are dropped.

An entry expires once ``window_s`` (60 s by default) pass without a copy being heard.
Every copy refreshes it, so a packet that stays on air (a node or phone that keeps
advertising its last packet) is dropped for as long as it is heard, not re-emitted every
minute. The 60 s matches the nodes' own seen-cache window, and it means a node that
reboots and starts reusing ``msg_id`` values still gets through after a minute of quiet
instead of being silenced for the rest of the run.
"""

import time
from collections.abc import Callable


class Dedup:
    def __init__(self, window_s: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.window_s = window_s
        self._clock = clock
        # Insertion order == time order (a hit is moved to the end), so the oldest entries
        # are always at the front.
        self._last_seen: dict[tuple[int, int], float] = {}

    def seen(self, src: int, msg_id: int) -> bool:
        """Return True if this is a duplicate (drop it). Every copy refreshes the entry."""
        now = self._clock()
        self._prune(now)
        key = (src, msg_id)
        dup = self._last_seen.pop(key, None) is not None
        self._last_seen[key] = now
        return dup

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_s
        while self._last_seen:
            key, t = next(iter(self._last_seen.items()))
            if t > cutoff:
                break
            del self._last_seen[key]

    def __len__(self) -> int:
        return len(self._last_seen)
