"""Run the int8 model over a recording, the way a node would hear it.

Slides a 1-second window along the file in ~250 ms steps, with the feature extractor
running continuously (as on the board), and prints every window that would raise an alert.

    uv run predict.py take.wav
    uv run predict.py take.wav --all     # print every window, not just alerts
"""

from __future__ import annotations

import argparse
import json

import numpy as np

import features
from config import ALERT_CLASSES, CLASSES, OUT
from dataset import load_recording
from train import decide, run_tflite

HOP_FRAMES = 12  # 240 ms between inferences; the board aims for ~250 ms


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("wav", help="mono recording; 24-bit files are treated as raw INMP441 audio")
    ap.add_argument("--all", action="store_true", help="print every window")
    ap.add_argument("--model", default=str(OUT / "serra.tflite"))
    args = ap.parse_args()

    audio = load_recording(args.wav)
    pcm = np.clip(audio * 32768, -32768, 32767).astype(np.int16)
    frames = features.extract(pcm)
    starts = range(0, len(frames) - features.FRAMES + 1, HOP_FRAMES)
    if not starts:
        raise SystemExit("recording is shorter than one second")
    x = np.stack([frames[s : s + features.FRAMES] for s in starts])
    x = x.astype(np.float32)[..., None] / 255.0

    thresholds = json.loads((OUT / "thresholds.json").read_text())
    with open(args.model, "rb") as f:
        scores = run_tflite(f.read(), x)
    alerts = decide(scores, [thresholds[c] for c in ALERT_CLASSES])

    print(f"{len(audio) / features.SAMPLE_RATE:.1f} s, {len(x)} windows")
    for s, score, alert in zip(starts, scores, alerts, strict=True):
        if alert < 0 and not args.all:
            continue
        t0 = s * features.STEP / features.SAMPLE_RATE
        top = int(score.argmax())
        mark = f"ALERT {CLASSES[alert]}" if alert >= 0 else ""
        print(f"{t0:6.2f}-{t0 + 1:5.2f} s  {CLASSES[top]:12s} {score[top]:.2f}  {mark}")
    print(f"{int((alerts >= 0).sum())} alert windows")


if __name__ == "__main__":
    main()
