"""Serranet wire format: decode and encode the packets nodes broadcast.

Mirrors firmware/mesh/packet.h. The packet format is a team contract: a change here
follows CONTRIBUTING's packet-format contract (firmware, base station, README and the
Supabase migration change in the same PR).

Input is the manufacturer data of one BLE advertisement under company ID 0xFFFF, with
the company ID already stripped (bleak does this), so it starts at the magic byte.
Everything is little-endian.
"""

import struct
from dataclasses import dataclass

# Pinned to packet.h; tests/test_protocol.py reads that file and fails if any differ.
MAGIC = 0x5E  # MESH_MAGIC
COMPANY_ID = 0xFFFF  # MESH_COMPANY_ID
DST_BROADCAST = 0xFFFF  # MESH_DST_BROADCAST
TTL_INITIAL = 4  # MESH_TTL_DEFAULT: the ttl every packet starts with, so hops = 4 - ttl

TYPE_ALERT = 1
TYPE_HEARTBEAT = 2
TYPE_NAMES = {TYPE_ALERT: "ALERT", TYPE_HEARTBEAT: "HEARTBEAT"}

CLASS_WHISTLE = 1
CLASS_SCREAM = 2
CLASS_HELP = 3
CLASS_NAMES = {CLASS_WHISTLE: "whistle", CLASS_SCREAM: "scream", CLASS_HELP: "help"}

# magic u8, src u16, dst u16, msg_id u16, ttl u8, type u8 -> 9 bytes
HEADER = struct.Struct("<BHHHBB")
# class_id u8, confidence u8, peak_level i16 (tenths of a dB), timestamp u32 (ms uptime),
# blast_count u8 -> 9 bytes
ALERT = struct.Struct("<BBhIB")


class DecodeError(ValueError):
    """A packet was rejected. `reason` is one of: bad_magic, too_short, unknown_type."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True, slots=True)
class Alert:
    class_id: int
    confidence: int
    peak_level: int
    timestamp: int
    blast_count: int

    @property
    def class_name(self) -> str:
        return CLASS_NAMES.get(self.class_id, f"unknown_{self.class_id}")


@dataclass(frozen=True, slots=True)
class Packet:
    magic: int
    src: int
    dst: int
    msg_id: int
    ttl: int
    type: int
    alert: Alert | None
    raw: bytes

    @property
    def type_name(self) -> str:
        return TYPE_NAMES[self.type]

    @property
    def hops(self) -> int:
        return TTL_INITIAL - self.ttl


def decode(data: bytes, magic: int = MAGIC) -> Packet:
    """Decode one packet. Raises DecodeError; trailing extra bytes are tolerated."""
    if not data:
        raise DecodeError("too_short", "empty")
    if data[0] != magic:
        raise DecodeError("bad_magic", f"0x{data[0]:02x}")
    if len(data) < HEADER.size:
        raise DecodeError("too_short", f"{len(data)} < {HEADER.size} header bytes")

    pkt_magic, src, dst, msg_id, ttl, type_ = HEADER.unpack_from(data)
    if type_ not in TYPE_NAMES:
        raise DecodeError("unknown_type", str(type_))

    alert = None
    if type_ == TYPE_ALERT:
        need = HEADER.size + ALERT.size
        if len(data) < need:
            raise DecodeError("too_short", f"{len(data)} < {need} alert bytes")
        alert = Alert(*ALERT.unpack_from(data, HEADER.size))

    return Packet(pkt_magic, src, dst, msg_id, ttl, type_, alert, bytes(data))


def encode_alert(
    *,
    src: int,
    msg_id: int,
    ttl: int,
    class_id: int,
    confidence: int,
    peak_level: int,
    timestamp: int,
    blast_count: int,
    dst: int = DST_BROADCAST,
    magic: int = MAGIC,
) -> bytes:
    header = HEADER.pack(magic, src, dst, msg_id, ttl, TYPE_ALERT)
    return header + ALERT.pack(class_id, confidence, peak_level, timestamp, blast_count)


def encode_heartbeat(
    *,
    src: int,
    msg_id: int,
    ttl: int,
    payload: bytes = b"",
    dst: int = DST_BROADCAST,
    magic: int = MAGIC,
) -> bytes:
    return HEADER.pack(magic, src, dst, msg_id, ttl, TYPE_HEARTBEAT) + payload
