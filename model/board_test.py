"""Check the classifier on a Pico against the PC, and watch it listen.

Flash firmware/tools/classifier_bench first (see its CMakeLists.txt), then:

    uv run board_test.py                 # arena size, timing, and scores vs the PC
    uv run board_test.py --listen 30     # then print what the board hears for 30 s

The board runs the model on four fixed inputs; this runs out/serra.tflite on the same four
and expects identical scores. So firmware/classifier/model_data.cc must hold the same model
as out/serra.tflite: rebuild and reflash the bench after every train.py run.
"""

from __future__ import annotations

import argparse
import time

import numpy as np
import serial

from config import CLASSES, OUT
from record import find_port
from train import run_tflite

FRAMES, CHANNELS = 49, 40
PATTERNS = 4


def pattern(n: int) -> np.ndarray:
    """Fixed test input n, as fill_pattern() in firmware/tools/classifier_bench/main.c."""
    state = 1 + n
    out = np.zeros(FRAMES * CHANNELS, dtype=np.uint8)
    for i in range(len(out)):
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        r = state >> 24
        if n == 0:
            out[i] = 0
        elif n == 1:
            out[i] = r
        elif n == 2:
            out[i] = r & 0x3F
        else:
            out[i] = 220 if 20 <= i % CHANNELS <= 22 else r & 0x1F
    return out.reshape(FRAMES, CHANNELS)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--listen", type=float, default=0, help="seconds of live output to show")
    ap.add_argument("--quiet", action="store_true", help="live: print only detections")
    ap.add_argument("--port", help="serial port (default: the one Pico that is plugged in)")
    args = ap.parse_args()

    port = serial.Serial(args.port or find_port(), timeout=5)
    report: dict[str, list[str]] = {}
    board_scores = {}
    while True:
        line = port.readline().decode(errors="replace").strip()
        if not line:
            raise SystemExit("No report from the Pico. Is it running classifier_bench?")
        key, *rest = line.split()
        if key == "pattern":
            board_scores[int(rest[0])] = [int(v) for v in rest[1:]]
        report[key] = rest
        if key == "live" or report.get("init") == ["failed"]:
            break

    if report["init"] != ["ok"]:
        raise SystemExit("classifier_init() failed on the board.")
    used, size = (int(v) for v in report["arena"])
    lo, mean, hi = (int(v) for v in report["infer_us"])
    print(f"Arena:     {used:,} of {size:,} bytes used")
    print(f"Heap:      {int(report['heap'][0]):,} bytes for the feature tables")
    print(f"Inference: {mean / 1000:.1f} ms (min {lo / 1000:.1f}, max {hi / 1000:.1f})")
    print(f"Features:  {int(report['features_us'][0]) / 1000:.2f} ms per 20 ms frame")

    x = np.stack([pattern(n) for n in range(PATTERNS)]).astype(np.float32)[..., None] / 255.0
    pc = np.round(run_tflite((OUT / "serra.tflite").read_bytes(), x) * 256).astype(int)
    same = True
    for n in range(PATTERNS):
        match = board_scores.get(n) == pc[n].tolist()
        same &= match
        print(f"Pattern {n}: board {board_scores.get(n)}  PC {pc[n].tolist()}  {'same' if match else 'DIFFERENT'}")
    print("Board and PC agree." if same else "Board and PC DISAGREE: is the board's model current?")

    if args.listen:
        print(f"\nListening for {args.listen:g} s. level dBFS | ran model | top class, score")
        end = time.monotonic() + args.listen
        steps = ran = 0
        while time.monotonic() < end:
            key, *rest = (port.readline().decode(errors="replace").split() or [""])
            if key == "w":
                steps += 1
                ran += int(rest[1])
                scores = [int(v) for v in rest[3:8]]
                top = int(np.argmax(scores))
                if not args.quiet:
                    what = f"{CLASSES[top]:12s} {scores[top] / 256:.2f}  {int(rest[2]) / 1000:.1f} ms" if rest[1] == "1" else "(quiet, skipped)"
                    print(f"{int(rest[0]) / 10:7.1f}  {what}")
            elif key == "alert":
                c, conf, peak, blasts = (int(v) for v in rest)
                extra = f", {blasts} blast{'s' * (blasts != 1)}" if c == 1 else ""
                print(f"*** ALERT {CLASSES[c - 1]}: confidence {conf / 255:.2f}, peak {peak / 10:.1f} dB{extra}")
        print(f"{steps} steps, model ran on {ran} ({ran / max(1, steps):.0%}).")


if __name__ == "__main__":
    main()
