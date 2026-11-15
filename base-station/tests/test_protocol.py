import json
import re
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


PACKET_H = Path(__file__).resolve().parents[2] / "firmware" / "mesh" / "packet.h"

# packet.h name -> protocol.py value. TTL_INITIAL is the firmware's MESH_TTL_DEFAULT: the ttl
# every packet starts with, so hops = TTL_INITIAL - ttl.
PINNED = {
    "MESH_MAGIC": protocol.MAGIC,
    "MESH_COMPANY_ID": protocol.COMPANY_ID,
    "MESH_DST_BROADCAST": protocol.DST_BROADCAST,
    "MESH_TTL_DEFAULT": protocol.TTL_INITIAL,
    "MESH_TYPE_ALERT": protocol.TYPE_ALERT,
    "MESH_TYPE_HEARTBEAT": protocol.TYPE_HEARTBEAT,
    "CLASS_WHISTLE": protocol.CLASS_WHISTLE,
    "CLASS_SCREAM": protocol.CLASS_SCREAM,
    "CLASS_HELP": protocol.CLASS_HELP,
}


def _firmware_constants() -> dict[str, int]:
    """`#define NAME value` and `NAME = value,` (enum members) from packet.h."""
    text = PACKET_H.read_text()
    found = re.findall(r"^#define\s+(\w+)\s+(0x[0-9A-Fa-f]+|\d+)\b", text, re.M)
    found += re.findall(r"^\s*(\w+)\s*=\s*(0x[0-9A-Fa-f]+|\d+)\s*,", text, re.M)
    return {name: int(value, 0) for name, value in found}


@pytest.mark.skipif(not PACKET_H.exists(), reason="firmware/mesh/packet.h not in this checkout")
@pytest.mark.parametrize("name", PINNED)
def test_constants_match_firmware(name: str) -> None:
    # The wire constants are pinned to the firmware: change one side, this fails until the
    # other side changes too (CONTRIBUTING's packet-format contract).
    firmware = _firmware_constants()
    assert name in firmware, f"{name} not found in {PACKET_H}"
    assert firmware[name] == PINNED[name], f"{name}: firmware {firmware[name]:#x}"
