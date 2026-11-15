"""Simulated mesh: fake nodes raising alerts, heard directly and via relays.

Lets app/ and the rest of the pipeline run with no Pi and no Picos.
"""

import asyncio
import random
from collections.abc import AsyncIterator

from serra_base.protocol import MAGIC, TTL_INITIAL, encode_alert, encode_heartbeat
from serra_base.sources import Advert, now_ms

# Placeholder node IDs until app/supabase/seed.sql exists; then use the IDs from there.
NODES = (0x1C4E, 0x2A10, 0x3B7F)
EXTRA_RELAYS = (0x4D21, 0x5E93)  # relays that never originate in the sim
WHISTLE = 1


def _addr(node: int) -> str:
    return f"SIM:{node:04X}"


async def run(
    magic: int = MAGIC, seed: int | None = None, interval_s: float = 2.0
) -> AsyncIterator[Advert]:
    """Forever: every `interval_s`, one node raises an alert heard over 2-4 paths.

    Every 5th round (from round 2) also yields a heartbeat, every 7th (from round 3)
    an advert with the wrong magic byte, so all counters move within a few seconds.
    """
    rng = random.Random(seed)
    msg_ids = {node: rng.randrange(0x10000) for node in NODES}
    boot_ms = {node: now_ms() - rng.randint(10_000, 600_000) for node in NODES}

    def next_msg_id(node: int) -> int:
        msg_ids[node] = (msg_ids[node] + 1) & 0xFFFF
        return msg_ids[node]

    async def jitter() -> None:
        await asyncio.sleep(rng.uniform(0.005, 0.050))

    round_no = 0
    while True:
        round_no += 1
        src = rng.choice(NODES)
        class_id = rng.randint(1, 3)
        fields = dict(
            src=src,
            msg_id=next_msg_id(src),
            class_id=class_id,
            confidence=rng.randint(120, 255),
            peak_level=rng.randint(600, 950),
            timestamp=(now_ms() - boot_ms[src]) & 0xFFFFFFFF,
            blast_count=3 if class_id == WHISTLE else 0,
        )
        ttl = rng.randint(1, TTL_INITIAL)  # ttl when it reaches us directly

        # Original copy, then relays rebroadcasting the same bytes with ttl decremented.
        data = encode_alert(ttl=ttl, magic=magic, **fields)
        yield Advert(now_ms(), _addr(src), rng.randint(-80, -50), data)
        others = [n for n in NODES + EXTRA_RELAYS if n != src]
        relays = rng.sample(others, min(rng.randint(1, 3), ttl))
        for hop, relay in enumerate(relays, start=1):
            await jitter()
            data = encode_alert(ttl=ttl - hop, magic=magic, **fields)
            yield Advert(now_ms(), _addr(relay), rng.randint(-95, -60), data)

        if round_no % 5 == 2:
            node = rng.choice(NODES)
            data = encode_heartbeat(
                src=node, msg_id=next_msg_id(node), ttl=TTL_INITIAL, magic=magic
            )
            await jitter()
            yield Advert(now_ms(), _addr(node), rng.randint(-80, -50), data)

        if round_no % 7 == 3:
            await jitter()
            data = encode_alert(ttl=ttl, magic=magic ^ 0xFF, **fields)  # someone else's prototype
            yield Advert(now_ms(), "SIM:0BAD", rng.randint(-90, -60), data)

        await asyncio.sleep(interval_s)
