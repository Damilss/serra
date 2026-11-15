"""Fetch the non-speech datasets: screams and background noise.

- Nonspeech7k (Zenodo 6967442, CC-BY 4.0): human non-speech sounds. "screaming" feeds the
  scream class; breath / cough / crying / laugh / sneeze / yawn go to background, so the
  model learns that not every human noise is a scream.
- DEMAND (Zenodo 1227121, CC-BY 4.0): real background noise (park, field, river, office,
  cafeteria, ...). Only channel 1 of each 16 kHz recording is kept.

About 3.3 GB to download, 2.7 GB kept on disk.

    uv run fetch_sounds.py
"""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

from fetch_mswc import download

DATA = Path(__file__).parent / "data"
RAW = DATA / "raw"

NONSPEECH = "https://zenodo.org/api/records/6967442/files"
NONSPEECH_FILES = {
    "train.zip": "train.zip",
    "test.zip": "test.zip",
    "train.csv": "metadata%20of%20train%20set%20.csv",
    "test.csv": "metadata%20of%20test%20set.csv",
}

DEMAND = "https://zenodo.org/api/records/1227121/files"
# Outdoor scenes first (where nodes live), then rooms (where the demo happens).
DEMAND_ENVS = [
    "NPARK",
    "NFIELD",
    "NRIVER",
    "STRAFFIC",
    "SPSQUARE",
    "DLIVING",
    "OOFFICE",
    "OMEETING",
    "OHALLWAY",
    "PCAFETER",
]


def fetch_nonspeech(keep: bool) -> None:
    out = DATA / "nonspeech7k"
    for local, remote in NONSPEECH_FILES.items():
        print(f"nonspeech7k/{local}")
        if local.endswith(".csv"):
            download(f"{NONSPEECH}/{remote}/content", out / local)
            continue
        split = local.removesuffix(".zip")
        # Written only after every clip is out, so an interrupted run extracts again.
        done = out / f"{split}.done"
        if done.exists():
            continue
        archive = RAW / "nonspeech7k" / local
        download(f"{NONSPEECH}/{remote}/content", archive)
        n = 0
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                if info.is_dir() or not info.filename.lower().endswith(".wav"):
                    continue
                dest = out / split / Path(info.filename).name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(z.read(info))
                n += 1
        done.touch()
        print(f"  extracted {n} clips")
        if not keep:
            archive.unlink()
            archive.with_suffix(".zip.done").unlink(missing_ok=True)


def fetch_demand(keep: bool) -> None:
    out = DATA / "demand"
    out.mkdir(parents=True, exist_ok=True)
    for env in DEMAND_ENVS:
        dest = out / f"{env}.wav"
        if dest.exists():
            continue
        print(f"demand/{env}")
        archive = RAW / "demand" / f"{env}_16k.zip"
        download(f"{DEMAND}/{env}_16k.zip/content", archive)
        with zipfile.ZipFile(archive) as z:
            name = next(n for n in z.namelist() if n.endswith("ch01.wav"))
            # Through a temp file, so an interrupted write never looks like a finished one.
            part = dest.with_suffix(".wav.part")
            part.write_bytes(z.read(name))
            part.replace(dest)
        if not keep:
            archive.unlink()
            archive.with_suffix(".zip.done").unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep", action="store_true", help="keep the downloaded archives")
    args = ap.parse_args()
    fetch_demand(args.keep)
    fetch_nonspeech(args.keep)


if __name__ == "__main__":
    main()
