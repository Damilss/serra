"""Fetch the slice of the Multilingual Spoken Words Corpus (MSWC) that Serra needs.

MSWC (MLCommons, CC-BY 4.0) is ~28 GB of English Opus clips split into alphabetically
sorted shards. We only need the shards that hold "help", plus a few others for a varied
`other_speech` class, so this downloads about 1.7 GB instead of all of it.

Clips are kept as the original 48 kHz Opus files under data/mswc/<split>/<word>/.
Decoding and resampling happen when features are built (dataset.py).

    uv run fetch_mswc.py            # download + extract
    uv run fetch_mswc.py --keep     # keep the downloaded shards afterwards
"""

from __future__ import annotations

import argparse
import tarfile
import urllib.request
from collections import Counter
from pathlib import Path

BASE = "https://huggingface.co/datasets/MLCommons/ml_spoken_words/resolve/main/data/opus/en"

# (split, shard). train/33, dev/4 and test/4 are the shards containing "help".
# The extra train shards only feed other_speech, so it isn't all words starting with "h".
SHARDS = [
    ("train", 33),
    ("dev", 4),
    ("test", 4),
    ("train", 7),
    ("train", 50),
    ("train", 70),
]

KEYWORD = "help"
# Clips kept per non-keyword word and split. Keeps other_speech broad instead of letting
# a handful of very common words ("her", "have") dominate it.
MAX_PER_WORD = {"train": 30, "dev": 12, "test": 12}

DATA = Path(__file__).parent / "data"
RAW = DATA / "raw" / "mswc"
OUT = DATA / "mswc"


def download(url: str, dest: Path) -> None:
    """Download with resume, so an interrupted run picks up where it stopped."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    done = dest.with_suffix(dest.suffix + ".done")
    if done.exists():
        return
    have = dest.stat().st_size if dest.exists() else 0
    req = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
    with urllib.request.urlopen(req, timeout=60) as resp:
        if have and resp.status != 206:
            have = 0  # server ignored the range: start over
        total = have + int(resp.headers.get("Content-Length", 0))
        with open(dest, "ab" if have else "wb") as f:
            while chunk := resp.read(1 << 20):
                f.write(chunk)
                have += len(chunk)
                print(
                    f"\r  {dest.name}: {have / 1e6:6.0f} / {total / 1e6:.0f} MB", end="", flush=True
                )
    print()
    done.touch()


def word_of(name: str) -> str:
    # "help_common_voice_en_123.opus" -> "help"
    return Path(name).name.split("_common_voice_")[0]


def extract(tar_path: Path, split: str) -> Counter:
    kept: Counter = Counter()
    cap = MAX_PER_WORD[split]
    with tarfile.open(tar_path, "r:gz") as tar:
        for member in tar:
            if not member.isfile() or not member.name.endswith(".opus"):
                continue
            word = word_of(member.name)
            if word != KEYWORD and kept[word] >= cap:
                continue
            dest = OUT / split / word / Path(member.name).name
            if not dest.exists():
                src = tar.extractfile(member)
                if src is None:
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(src.read())
            kept[word] += 1
    return kept


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep", action="store_true", help="keep the downloaded shard archives")
    args = ap.parse_args()

    for split, shard in SHARDS:
        tar_path = RAW / f"{split}_{shard}.tar.gz"
        print(f"{split}/{shard}")
        download(f"{BASE}/{split}/audio/{shard}.tar.gz", tar_path)
        kept = extract(tar_path, split)
        print(
            f"  kept {sum(kept.values())} clips, {len(kept)} words, {kept[KEYWORD]} x '{KEYWORD}'"
        )
        if not args.keep:
            tar_path.unlink()
            # Remove the .done marker as well, so a re-run re-downloads cleanly.
            tar_path.with_suffix(tar_path.suffix + ".done").unlink(missing_ok=True)


if __name__ == "__main__":
    main()
