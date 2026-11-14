import json
from pathlib import Path

import pytest

from serra_base import protocol
from serra_base.protocol import DecodeError, decode, encode_alert, encode_heartbeat

VECTORS = json.loads((Path(__file__).parent / "vectors.json").read_text())
IDS = [v["name"] for v in VECTORS]


@pytest.mark.parametrize("vec", VECTORS, ids=IDS)
def test_decode_vector(vec: dict) -> None:
    exp = vec["expect"]
    pkt = decode(bytes.fromhex(vec["hex"]))

    assert pkt.raw == bytes.fromhex(vec["hex"])
    for field in ("magic", "src", "dst", "msg_id", "ttl", "hops"):
        assert getattr(pkt, field) == exp[field], field
    assert pkt.type_name == exp["type"]

    if exp["alert"] is None:
        assert pkt.alert is None
        return
    assert pkt.alert is not None
    alert = exp["alert"]
    assert pkt.alert.class_name == alert["class"]
    for field in ("class_id", "confidence", "peak_level", "timestamp", "blast_count"):
        assert getattr(pkt.alert, field) == alert[field], field


@pytest.mark.parametrize("vec", VECTORS, ids=IDS)
def test_encode_round_trip(vec: dict) -> None:
    exp = vec["expect"]
    common = dict(src=exp["src"], dst=exp["dst"], msg_id=exp["msg_id"], ttl=exp["ttl"])
    if exp["type"] == "ALERT":
        a = exp["alert"]
        data = encode_alert(
            **common,
            class_id=a["class_id"],
            confidence=a["confidence"],
            peak_level=a["peak_level"],
            timestamp=a["timestamp"],
            blast_count=a["blast_count"],
        )
    else:
        data = encode_heartbeat(**common)
    assert data.hex() == vec["hex"]


def test_sizes_match_firmware() -> None:
    assert protocol.HEADER.size == 9
    assert protocol.ALERT.size == 9


ALERT_BYTES = encode_alert(
    src=1, msg_id=1, ttl=4, class_id=1, confidence=200, peak_level=900, timestamp=1, blast_count=3
)


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        (b"", "too_short"),
        (b"\x9e" + ALERT_BYTES[1:], "bad_magic"),
        (ALERT_BYTES[:8], "too_short"),
        (ALERT_BYTES[:17], "too_short"),
        (ALERT_BYTES[:8] + b"\x09", "unknown_type"),
    ],
    ids=["empty", "wrong_magic", "short_header", "truncated_alert", "unknown_type"],
)
def test_rejects(data: bytes, reason: str) -> None:
    with pytest.raises(DecodeError) as err:
        decode(data)
    assert err.value.reason == reason


def test_custom_magic() -> None:
    data = encode_heartbeat(src=5, msg_id=6, ttl=2, magic=0x9E)
    assert decode(data, magic=0x9E).magic == 0x9E
    with pytest.raises(DecodeError) as err:
        decode(data)
    assert err.value.reason == "bad_magic"


def test_trailing_bytes_tolerated() -> None:
    data = ALERT_BYTES + b"\xaa\xbb"
    pkt = decode(data)
    assert pkt.raw == data
    assert pkt.alert is not None and pkt.alert.blast_count == 3


def test_heartbeat_payload_passed_through() -> None:
    data = encode_heartbeat(src=5, msg_id=6, ttl=2, payload=b"\x01\x02")
    pkt = decode(data)
    assert pkt.type_name == "HEARTBEAT"
    assert pkt.alert is None
    assert pkt.raw.endswith(b"\x01\x02")


def test_unknown_class_name() -> None:
    assert protocol.Alert(9, 0, 0, 0, 0).class_name == "unknown_9"
