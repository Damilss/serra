"""Build the feature datasets: data/features/{train,dev,test}.npz.

Every example is one second of audio as the node would hear it, turned into the 49 x 40
feature image the model takes. To get there from mixed sources, each example is built as

    2 s of background noise (lead-in)  +  1 s of (sound + background noise)

and run through the firmware's feature code; the features of the last second are kept. The
lead-in matters because the feature extractor adapts to what it has just heard (noise
estimate and automatic gain), exactly as it will on a node that is always listening. For
the same reason some examples put the sound in the lead-in, or leave only a sliver of it in
the window, and are labelled background: see stream_offset().

Sources per class (see README.md for licenses):
    whistle        synthetic blasts (synth.py)                 + recordings/whistle
    scream         Nonspeech7k "screaming"                     + recordings/scream
    help           Spoken Words Corpus "help"                  + recordings/help
    other_speech   Spoken Words Corpus, every other word       + recordings/other_speech
    background     DEMAND noise, Nonspeech7k coughs / laughs / breathing ...,
                   synthetic noise and chirps                  + recordings/background

    uv run dataset.py
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import multiprocessing as mp
from collections import Counter
from dataclasses import dataclass

import numpy as np
import soundfile as sf
from scipy import signal

import features
import synth
from config import CLASSES, CLIP, DATA, FEATURES, RECORDINGS, SAMPLE_RATE

SPLITS = ["train", "dev", "test"]

# How many differently-augmented examples each source clip yields in the training set.
# Small sources get more passes; dev and test always get REPEATS_EVAL.
REPEATS_TRAIN = {"help": 3, "other_speech": 1, "scream": 10, "nonspeech": 2, "recording": 12}
REPEATS_EVAL = {"help": 1, "other_speech": 1, "scream": 4, "nonspeech": 1, "recording": 4}

# Clip caps and synthetic counts per split, to keep classes within sight of each other.
OTHER_SPEECH_CLIPS = {"train": 13000, "dev": 2500, "test": 2500}
SYNTH_WHISTLES = {"train": 9000, "dev": 1000, "test": 1000}
NOISE_ONLY = {"train": 5000, "dev": 700, "test": 700}
CHIRPS = {"train": 1500, "dev": 200, "test": 200}

# Share of examples per source that show the stream just after the sound, or only an
# edge of it, and are therefore labelled background: (after, edge). See stream_offset().
# No edge cases for whistles and screams: a short piece of either is still one.
STREAM_NEGATIVES = {
    "whistle": (0.18, 0.0),
    "scream": (0.18, 0.0),
    "help": (0.15, 0.15),
    "other_speech": (0.10, 0.10),
}

# Mic self-noise after the fixed gain (features.h): about 4 counts RMS.
SELF_NOISE_DB = -78.0


@dataclass(frozen=True)
class Item:
    """One example to generate. `kind` picks the recipe, `path` the source clip if any."""

    label: int
    kind: str
    path: str = ""
    start: int = 0  # recordings: first sample of the 1 s window
    seed: int = 0


# ---- source discovery ------------------------------------------------------------------


def bucket(key: str) -> str:
    """Stable 80 / 10 / 10 split from a hash, so a clip never changes sides between runs."""
    h = int(hashlib.sha1(key.encode()).hexdigest(), 16) % 100
    return "train" if h < 80 else "dev" if h < 90 else "test"


def recording_split(index: int) -> str:
    """Split for a class's index-th recording, in file-name (so time) order.

    Of every five, the third is test and the fifth is dev. A hash would do for thousands of
    clips, but with a handful of takes it can leave a class with nothing to test on. Earlier
    takes keep their side as new ones are added.
    """
    return {2: "test", 4: "dev"}.get(index % 5, "train")


def mswc_items(split: str, rng: np.random.Generator) -> list[tuple[str, str]]:
    """(class, path) for Spoken Words Corpus clips. The corpus ships its own splits."""
    root = DATA / "mswc" / split
    if not root.is_dir():
        return []
    out = [("help", str(p)) for p in sorted((root / "help").glob("*.opus"))]
    # Words built on "help" (helped, helping, helpless, ...) are left out of both classes:
    # they are neither a clean "help" nor fair examples of ordinary speech.
    others = [
        str(p)
        for word in sorted(root.iterdir())
        if word.is_dir() and not word.name.startswith("help")
        for p in sorted(word.glob("*.opus"))
    ]
    rng.shuffle(others)
    out += [("other_speech", p) for p in others[: OTHER_SPEECH_CLIPS[split]]]
    return out


def nonspeech_items(split: str) -> list[tuple[str, str]]:
    """(class, path) for Nonspeech7k.

    Re-split by source recording ("File ID"), because its segments are cut from longer files
    and neighbours must not straddle splits.
    """
    root = DATA / "nonspeech7k"
    out = []
    for part in ("train", "test"):
        meta = root / f"{part}.csv"
        if not meta.exists():
            continue
        with open(meta, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                row = {k.strip().lower().replace(" ", ""): v.strip() for k, v in row.items()}
                path = root / part / row["filename"]
                file_id = row.get("fileid") or row.get("file_id") or row["filename"]
                if bucket("nonspeech7k/" + file_id) != split or not path.exists():
                    continue
                kind = "scream" if row["classname"] == "screaming" else "nonspeech"
                out.append((kind, str(path)))
    return out


def recording_items(split: str) -> list[tuple[int, str, int]]:
    """(label, path, start) windows cut from our own recordings."""
    out = []
    for label, name in enumerate(CLASSES):
        for i, path in enumerate(sorted((RECORDINGS / name).glob("*.wav"))):
            if recording_split(i) != split:
                continue
            audio = load_recording(str(path))
            out += [(label, str(path), s) for s in find_windows(audio, name)]
    return out


def find_windows(audio: np.ndarray, name: str) -> list[int]:
    """Start samples of the 1 s windows worth using in a recording.

    Event classes (whistle, scream, help): one window centred on each burst of sound.
    other_speech: every half second where someone is talking. background: every second.
    """
    if len(audio) < CLIP:
        return [0]
    if name == "background":
        return list(range(0, len(audio) - CLIP + 1, CLIP))

    # Loudness in 20 ms steps, against the recording's own quiet level.
    hop = 320
    frames = len(audio) // hop
    rms = np.sqrt(np.mean(audio[: frames * hop].reshape(frames, hop) ** 2, axis=1) + 1e-12)
    level = 20 * np.log10(rms)
    active = level > max(np.percentile(level, 20) + 12, level.max() - 30)

    if name == "other_speech":
        starts = range(0, len(audio) - CLIP + 1, CLIP // 2)
        return [s for s in starts if active[s // hop : (s + CLIP) // hop].mean() > 0.2]

    # Group active frames into events, bridging gaps under 150 ms.
    events, start, gap = [], None, 0
    for i, on in enumerate(active):
        if on:
            start, gap = (i if start is None else start), 0
        elif start is not None:
            gap += 1
            if gap > 7:
                events.append((start, i - gap))
                start = None
    if start is not None:
        events.append((start, frames - 1))

    windows = []
    for first, last in events:
        if last - first < 4:  # under ~100 ms: a click, not a call
            continue
        a, b = first * hop, (last + 1) * hop
        if b - a <= CLIP:
            centres = [(a + b) // 2]
        else:  # a long blast or scream: several windows along it
            centres = list(range(a + CLIP // 2, b - CLIP // 2 + 1, CLIP // 2))
        windows += [int(np.clip(c - CLIP // 2, 0, len(audio) - CLIP)) for c in centres]
    return windows


# ---- audio loading ---------------------------------------------------------------------


def load_clip(path: str) -> np.ndarray:
    """Any audio file as float32 mono at 16 kHz."""
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != SAMPLE_RATE:
        g = np.gcd(rate, SAMPLE_RATE)
        audio = signal.resample_poly(audio, SAMPLE_RATE // g, rate // g).astype(np.float32)
    return audio


_recordings: dict[str, np.ndarray] = {}


def load_recording(path: str) -> np.ndarray:
    """One of our recordings as float32, converted the way the board converts mic audio.

    24-bit files (record.py, straight from the INMP441) go through the firmware's
    DC-removal and gain code. 16-bit files (a PC mic) are used as they are.
    """
    if path not in _recordings:
        info = sf.info(path)
        if info.samplerate != SAMPLE_RATE:
            audio = load_clip(path)
        elif info.subtype == "PCM_24":
            raw, _ = sf.read(path, dtype="int32", always_2d=True)
            pcm16, _ = features.pcm24_to_16(raw[:, 0] >> 8)
            audio = pcm16.astype(np.float32) / 32768
        else:
            audio = load_clip(path)
        _recordings[path] = audio
    return _recordings[path]


_noise: dict[str, list[np.ndarray]] = {}


def noise_bank(split: str) -> list[np.ndarray]:
    """DEMAND recordings, cut so each split draws from its own stretch of every file."""
    if split not in _noise:
        lo, hi = {"train": (0.0, 0.7), "dev": (0.7, 0.85), "test": (0.85, 1.0)}[split]
        bank = []
        for path in sorted((DATA / "demand").glob("*.wav")):
            audio = load_clip(str(path))
            part = audio[int(lo * len(audio)) : int(hi * len(audio))]
            bank.append(part / (np.sqrt(np.mean(part**2)) + 1e-9))
        _noise[split] = bank
    return _noise[split]


# ---- example synthesis -----------------------------------------------------------------


def background(n: int, split: str, rng: np.random.Generator) -> np.ndarray:
    """n samples of background at unit RMS: real noise, synthetic noise, or near silence."""
    bank = noise_bank(split)
    r = rng.random()
    if bank and r < 0.7:
        src = bank[rng.integers(len(bank))]
        start = rng.integers(0, len(src) - n)
        x = src[start : start + n]
        return x / (np.sqrt(np.mean(x**2)) + 1e-9)
    if r < 0.92 or not bank:
        return synth.coloured_noise(n, rng)
    return np.zeros(n, dtype=np.float32)


def window_power(x: np.ndarray, n: int) -> np.ndarray:
    """Mean power of every n-sample window of x (a running sum, so it stays fast)."""
    total = np.cumsum(np.concatenate([[0.0], x.astype(np.float64) ** 2]))
    return (total[n:] - total[:-n]) / n


def place(clip: np.ndarray, rng: np.random.Generator, loudest: bool) -> np.ndarray:
    """Fit a clip into one second.

    Long clips are cropped, around their loudest second if `loudest`; short ones are placed
    at random. Then shifted by up to 200 ms either way, since the node's 1 s window lands on
    a sound at an arbitrary offset.
    """
    if len(clip) > CLIP:
        if loudest:
            start = int(np.argmax(window_power(clip, CLIP))) + int(rng.integers(-1600, 1601))
        else:
            start = int(rng.integers(0, len(clip) - CLIP + 1))
        start = int(np.clip(start, 0, len(clip) - CLIP))
        clip = clip[start : start + CLIP]
    out = np.zeros(CLIP, dtype=np.float32)
    if len(clip) < CLIP:
        at = int(rng.integers(0, CLIP - len(clip) + 1))
        out[at : at + len(clip)] = clip
    else:
        out[:] = clip
    shift = int(rng.integers(-3200, 3201))
    out = np.roll(out, shift)
    if shift > 0:
        out[:shift] = 0
    elif shift < 0:
        out[shift:] = 0
    return out


def mix(fg: np.ndarray | None, split: str, rng: np.random.Generator, offset: int = 0) -> np.ndarray:
    """3 s of int16 audio: background throughout, with `fg` (1 s, any scale) added.

    The model's window is the last second. `fg` starts `offset` samples from the start of
    that window: 0 puts it in the window, a negative offset moves it back into the lead-in.

    Levels are drawn to cover what the mic delivers after its fixed gain: sounds peaking
    anywhere from -42 dBFS (far away) to clipping (right next to the node), over
    backgrounds from near silence to a noisy room.
    """
    n = 3 * CLIP
    noise = background(n, split, rng)
    if fg is None:
        noise_db = rng.uniform(-80, -28)
    else:
        peak_db = rng.uniform(-42, 2)  # above 0 clips, as a close whistle does
        fg = fg / (np.abs(fg).max() + 1e-9) * 10 ** (peak_db / 20)
        # Signal level = RMS over its loudest 300 ms; noise sits 0-35 dB below that.
        fg_db = 10 * np.log10(window_power(fg, 4800).max() + 1e-12)
        noise_db = float(np.clip(fg_db - rng.uniform(0, 35), -85, -28))
    x = noise * 10 ** (noise_db / 20)
    x += rng.standard_normal(n).astype(np.float32) * 10 ** (SELF_NOISE_DB / 20)
    if fg is not None:
        at = 2 * CLIP + offset
        keep = min(len(fg), n - at)
        x[at : at + keep] += fg[:keep]
    return np.clip(x * 32768, -32768, 32767).astype(np.int16)


def active_span(clip: np.ndarray) -> tuple[int, int]:
    """First and last sample of the audible part of a clip (within 20 dB of its peak)."""
    level = np.sqrt(window_power(clip, 320))
    loud = np.flatnonzero(level > 0.1 * level.max())
    if len(loud) == 0:  # a silent clip
        return 0, len(clip)
    return int(loud[0]), int(loud[-1]) + 320


def stream_offset(kind: str, clip: np.ndarray, rng: np.random.Generator) -> tuple[int, bool]:
    """Where to put a sound relative to the window, and whether the window still shows it.

    A node slides its window along a live stream, so besides windows that hold a whole
    sound it also sees the moments just after one (when the feature extractor is still
    adapted to it) and windows that catch only the first or last sliver of a word. Those
    must not raise alerts, so a share of examples are built that way and labelled
    background.
    """
    after, edge = STREAM_NEGATIVES.get(kind, (0.0, 0.0))
    r = rng.random()
    if r >= after + edge:
        return 0, True
    start, end = active_span(clip)
    if r < after:
        # The sound ended up to 750 ms before the window starts.
        return -end - int(rng.integers(0, 12000)), False
    # Only 5-25% of the sound is inside the window, at its start or its end.
    inside = int(rng.uniform(0.05, 0.25) * (end - start))
    if rng.random() < 0.5:
        return -(end - inside), False
    return CLIP - start - inside, False


def from_recording(item: Item, rng: np.random.Generator) -> np.ndarray:
    """3 s of int16 ending at the window's end, with the recording's own lead-in."""
    audio = load_recording(item.path)
    start = item.start + int(rng.integers(-2400, 2401))
    start = int(np.clip(start, 0, max(0, len(audio) - CLIP)))
    end = start + CLIP
    x = audio[max(0, end - 3 * CLIP) : end]
    if len(x) < 3 * CLIP:  # window near the start of the file: pad the lead-in
        pad = rng.standard_normal(3 * CLIP - len(x)).astype(np.float32)
        x = np.concatenate([pad * 10 ** (SELF_NOISE_DB / 20), x])
    x = x * 10 ** (rng.uniform(-10, 6) / 20)
    return np.clip(x * 32768, -32768, 32767).astype(np.int16)


def make(args: tuple[Item, str]) -> tuple[np.ndarray, int]:
    item, split = args
    rng = np.random.default_rng(item.seed)
    label = item.label
    if item.kind == "recording":
        pcm = from_recording(item, rng)
    elif item.kind == "chirps":
        pcm = mix(synth.chirps_clip(rng), split, rng)
    elif item.kind == "noise":
        pcm = mix(None, split, rng)
    else:
        if item.kind == "whistle":
            clip = synth.whistle_clip(rng)
        else:
            clip = place(load_clip(item.path), rng, loudest=item.kind == "scream")
        offset, shown = stream_offset(item.kind, clip, rng)
        pcm = mix(clip, split, rng, offset)
        if not shown:
            label = CLASSES.index("background")
    feats = features.extract(pcm)[-features.FRAMES :]
    return feats, label


# ---- build -----------------------------------------------------------------------------


def plan(split: str) -> list[Item]:
    rng = np.random.default_rng({"train": 1, "dev": 2, "test": 3}[split])
    repeats = REPEATS_TRAIN if split == "train" else REPEATS_EVAL
    label = {name: i for i, name in enumerate(CLASSES)}
    items: list[Item] = []

    for kind, path in mswc_items(split, rng):
        items += [Item(label[kind], kind, path)] * repeats[kind]
    for kind, path in nonspeech_items(split):
        cls = "scream" if kind == "scream" else "background"
        items += [Item(label[cls], kind, path)] * repeats[kind]
    for lab, path, start in recording_items(split):
        items += [Item(lab, "recording", path, start)] * repeats["recording"]

    items += [Item(label["whistle"], "whistle")] * SYNTH_WHISTLES[split]
    items += [Item(label["background"], "noise")] * NOISE_ONLY[split]
    items += [Item(label["background"], "chirps")] * CHIRPS[split]

    # Every example gets its own seed, so repeats of one clip are augmented differently.
    seeds = rng.integers(0, 2**62, size=len(items))
    return [
        Item(it.label, it.kind, it.path, it.start, int(s))
        for it, s in zip(items, seeds, strict=True)
    ]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--workers", type=int, default=max(1, mp.cpu_count() - 2))
    args = ap.parse_args()

    features.build()  # compile once here, not in every worker
    FEATURES.mkdir(parents=True, exist_ok=True)
    for split in SPLITS:
        items = plan(split)
        with mp.Pool(args.workers) as pool:
            results = pool.map(make, [(it, split) for it in items], chunksize=256)
        x = np.stack([r[0] for r in results])
        y = np.array([r[1] for r in results], dtype=np.uint8)
        kinds = np.array([it.kind for it in items])
        np.savez_compressed(FEATURES / f"{split}.npz", x=x, y=y, kind=kinds)

        per_class = Counter(y.tolist())
        counts = ", ".join(f"{name} {per_class[i]}" for i, name in enumerate(CLASSES))
        own = int((kinds == "recording").sum())
        print(f"{split:5s} {len(y):6d} examples ({counts}); {own} from our recordings")


if __name__ == "__main__":
    main()
