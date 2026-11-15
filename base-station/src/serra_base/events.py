"""Turn a decoded packet into the JSON event served on ``/events`` (see README)."""

from typing import Any

from serra_base.protocol import Packet


def to_event(pkt: Packet, *, run_id: str, seq: int, t_ms: int, rssi: int | None) -> dict[str, Any]:
    event: dict[str, Any] = {
        "run_id": run_id,
        "seq": seq,
        "t_ms": t_ms,
        "rssi": rssi,
        "raw": pkt.raw.hex(),
        "magic": pkt.magic,
        "src": pkt.src,
        "dst": pkt.dst,
        "msg_id": pkt.msg_id,
        "ttl": pkt.ttl,
        "hops": pkt.hops,
        "type": pkt.type_name,
    }
    if pkt.alert is not None:
        a = pkt.alert
        event["alert"] = {
            "class": a.class_name,
            "confidence": round(a.confidence / 255, 4),
            "peak_level": a.peak_level,
            "peak_db": a.peak_level / 10,
            "timestamp": a.timestamp,
            "blast_count": a.blast_count,
        }
    return event
