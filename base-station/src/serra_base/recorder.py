"""Appends raw advertisements to an NDJSON capture (feeds sources/replay.py)."""

import json
import os
from pathlib import Path
from types import TracebackType
from typing import Self

from serra_base.sources import Advert


class Recorder:
    """Writes one JSON line per advert: {"t_ms", "addr", "rssi", "data": hex}."""

    def __init__(self, path: str | os.PathLike) -> None:
        """Open `path` for appending, creating its directory. Raises OSError on failure."""
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._file = open(path, "a", encoding="utf-8", buffering=1)

    def write(self, adv: Advert) -> None:
        line = {"t_ms": adv.t_ms, "addr": adv.addr, "rssi": adv.rssi, "data": adv.data.hex()}
        self._file.write(json.dumps(line, separators=(",", ":")) + "\n")
        self._file.flush()

    def close(self) -> None:
        self._file.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()
