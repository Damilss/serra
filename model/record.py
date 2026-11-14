"""Record training audio through the INMP441, from a Pico running mic_capture.

Flash firmware/tools/mic_capture first (see README.md), plug the Pico in, then:

    uv run record.py --monitor                 # level meter only: check the mic works
    uv run record.py whistle                   # record until Ctrl-C
    uv run record.py help --seconds 60 --name sam-5m

Takes are saved as 24-bit, 16 kHz mono WAV in data/recordings/<class>/, exactly the
samples the node reads, so dataset.py runs them through the board's own conversion.
"""

from __future__ import annotations

import argparse
import math
import time
from datetime import datetime

import numpy as np
import serial
import soundfile as sf
from serial.tools import list_ports

from config import CLASSES, RECORDINGS, SAMPLE_RATE

MAGIC = b"SRA1"
PACKET_SAMPLES = 256
PACKET_BYTES = 8 + PACKET_SAMPLES * 3
STARTUP_SECONDS = 0.5  # the mic outputs zeros for ~256 ms after its clock starts
FULL_SCALE = 1 << 23
RASPBERRY_PI_VID = 0x2E8A


def find_port() -> str:
    ports = [p.device for p in list_ports.comports() if p.vid == RASPBERRY_PI_VID]
    if not ports:
        raise SystemExit(
            "No Pico found. Is it plugged in and running mic_capture? (pass --port to override)"
        )
    if len(ports) > 1:
        raise SystemExit(f"Several Picos found, pick one with --port: {', '.join(ports)}")
    return ports[0]


def packets(port: serial.Serial):
    """Yields (first sample index, int32 samples) for each packet, resyncing on the magic."""
    buf = bytearray()
    while True:
        chunk = port.read(4096)
        if not chunk:
            raise SystemExit("No data from the Pico for 2 s. Is it running mic_capture?")
        buf += chunk
        while True:
            at = buf.find(MAGIC)
            if at < 0:
                del buf[: max(0, len(buf) - 3)]  # keep a possible partial magic
                break
            if len(buf) - at < PACKET_BYTES:
                del buf[:at]
                break
            body = bytes(buf[at + 8 : at + PACKET_BYTES])
            index = int.from_bytes(buf[at + 4 : at + 8], "little")
            del buf[: at + PACKET_BYTES]
            raw = np.frombuffer(body, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
            value = raw[:, 0] | (raw[:, 1] << 8) | (raw[:, 2] << 16)
            yield index, np.where(value >= FULL_SCALE, value - 2 * FULL_SCALE, value)


def meter(block: np.ndarray, seconds: float, dropped: int) -> str:
    """One line of level meter. Levels are dBFS of the mic's 24-bit range, DC removed."""
    ac = block - block.mean()
    peak = 20 * math.log10(max(1.0, float(np.abs(ac).max())) / FULL_SCALE)
    rms = 20 * math.log10(max(1.0, float(np.sqrt(np.mean(ac**2)))) / FULL_SCALE)
    bar = "#" * int(np.clip((peak + 90) / 90 * 40, 0, 40))
    note = "  CLIPPING" if peak > -0.5 else ""
    lost = f"  ({dropped} samples dropped)" if dropped else ""
    return f"\r{seconds:6.1f} s  peak {peak:6.1f} dBFS  rms {rms:6.1f}  |{bar:<40}|{note}{lost}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("label", nargs="?", choices=CLASSES, help="class this take belongs to")
    ap.add_argument("--monitor", action="store_true", help="show levels, save nothing")
    ap.add_argument("--seconds", type=float, help="stop after this long (default: Ctrl-C)")
    ap.add_argument("--name", default="", help="short note for the file name, e.g. fox40-5m")
    ap.add_argument("--port", help="serial port (default: the one Pico that is plugged in)")
    args = ap.parse_args()
    if not args.monitor and not args.label:
        ap.error("give a class to record, or --monitor")

    port = serial.Serial(args.port or find_port(), timeout=2)
    port.reset_input_buffer()
    stream = packets(port)

    # Skip the mic's startup zeros and whatever was queued before we opened the port.
    deadline = time.monotonic() + STARTUP_SECONDS
    expected = None
    while time.monotonic() < deadline:
        index, _ = next(stream)
        expected = index + PACKET_SAMPLES

    takes: list[np.ndarray] = []
    total = dropped = 0
    recent: list[np.ndarray] = []
    print("Recording. Ctrl-C to stop." if not args.monitor else "Monitoring. Ctrl-C to stop.")
    try:
        for index, samples in stream:
            if index != expected:
                dropped += (index - expected) % (1 << 32)
            expected = index + PACKET_SAMPLES
            total += len(samples)
            if not args.monitor:
                takes.append(samples)
            recent.append(samples)
            if len(recent) * PACKET_SAMPLES >= SAMPLE_RATE // 8:
                block = np.concatenate(recent).astype(np.float64)
                print(meter(block, total / SAMPLE_RATE, dropped), end="", flush=True)
                recent = []
            if args.seconds and total >= args.seconds * SAMPLE_RATE:
                break
    except KeyboardInterrupt:
        pass
    print()

    if args.monitor or not takes:
        return
    audio = np.concatenate(takes)
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    name = f"{stamp}-{args.name}.wav" if args.name else f"{stamp}.wav"
    path = RECORDINGS / args.label / name
    path.parent.mkdir(parents=True, exist_ok=True)
    # soundfile takes 24-bit samples left-aligned in int32.
    sf.write(path, audio << 8, SAMPLE_RATE, subtype="PCM_24")
    print(f"Saved {len(audio) / SAMPLE_RATE:.1f} s to {path}")
    if dropped:
        print(f"Warning: {dropped} samples were dropped on the way from the Pico.")


if __name__ == "__main__":
    main()
