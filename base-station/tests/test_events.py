import json

from serra_base.events import to_event
from serra_base.protocol import Alert, Packet

# The README example: node 7246, msg_id 286, three hops out, a whistle at 62% confidence.
RAW = bytes.fromhex("5e4e1cffff1e010101019e5503c089460103")


def readme_packet() -> Packet:
    return Packet(
        magic=0x5E,
        src=7246,
        dst=0xFFFF,
        msg_id=286,
        ttl=1,
        type=1,
        alert=Alert(class_id=1, confidence=158, peak_level=853, timestamp=21400000, blast_count=3),
        raw=RAW,
    )


def test_readme_example():
    event = to_event(readme_packet(), run_id="6f1c2a", seq=1832, t_ms=5123456, rssi=-66)
    assert event == {
        "run_id": "6f1c2a",
        "seq": 1832,
        "t_ms": 5123456,
        "rssi": -66,
        "raw": "5e4e1cffff1e010101019e5503c089460103",
        "magic": 94,
        "src": 7246,
        "dst": 65535,
        "msg_id": 286,
        "ttl": 1,
        "hops": 3,
        "type": "ALERT",
        "alert": {
            "class": "whistle",
            "confidence": 0.6196,
            "peak_level": 853,
            "peak_db": 85.3,
            "timestamp": 21400000,
            "blast_count": 3,
        },
    }
    assert list(event) == [
        "run_id",
        "seq",
        "t_ms",
        "rssi",
        "raw",
        "magic",
        "src",
        "dst",
        "msg_id",
        "ttl",
        "hops",
        "type",
        "alert",
    ]


def test_heartbeat_has_no_alert():
    raw = bytes.fromhex("5e0100ffff0100040200")
    pkt = Packet(magic=0x5E, src=1, dst=0xFFFF, msg_id=1, ttl=4, type=2, alert=None, raw=raw)
    event = to_event(pkt, run_id="abc", seq=1, t_ms=0, rssi=None)
    assert "alert" not in event
    assert event["type"] == "HEARTBEAT"
    assert event["hops"] == 0
    assert event["rssi"] is None
    assert event["raw"] == "5e0100ffff0100040200"


def test_json_serialisable():
    event = to_event(readme_packet(), run_id="6f1c2a", seq=1, t_ms=1, rssi=None)
    assert json.loads(json.dumps(event)) == event
