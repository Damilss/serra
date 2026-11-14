"""Python binding for the firmware's feature extraction.

Compiles firmware/classifier/features.c and the vendored TFLM microfrontend into a shared
library and calls it through ctypes. Training therefore uses the very code that runs on the
Pico, so there is no second implementation to drift out of step.
"""

from __future__ import annotations

import ctypes
import subprocess
import sys
from pathlib import Path

import numpy as np

MODEL_DIR = Path(__file__).parent
CLASSIFIER = MODEL_DIR.parent / "firmware" / "classifier"
MICROFRONTEND = CLASSIFIER / "third_party" / "microfrontend"
KISSFFT = CLASSIFIER / "third_party" / "kissfft"
BUILD = MODEL_DIR / "build"

# Mirror firmware/classifier/features.h.
SAMPLE_RATE = 16000
CHANNELS = 40
FRAMES = 49
STEP = 320  # samples between frames (20 ms)
WINDOW = 480  # samples per frame (30 ms)
PCM24_SHIFT = 6

_lib: ctypes.CDLL | None = None


def _sources() -> tuple[list[Path], list[Path]]:
    lib = MICROFRONTEND / "tensorflow/lite/experimental/microfrontend/lib"
    c = [CLASSIFIER / "features.c", MODEL_DIR / "features_host.c", *sorted(lib.glob("*.c"))]
    # KISS FFT's headers have no extern "C" guards and the microfrontend calls it from C++,
    # so it is built as C++ (as TFLM does). The firmware's CMake does the same.
    cxx = [*sorted(lib.glob("*.cc")), KISSFFT / "kiss_fft.c", KISSFFT / "tools" / "kiss_fftr.c"]
    return c, cxx


def build() -> Path:
    """Compile the shared library if it is missing or older than its sources."""
    suffix = {"darwin": "dylib", "win32": "dll"}.get(sys.platform, "so")
    out = BUILD / f"libserra_features.{suffix}"
    c_src, cc_src = _sources()
    deps = [*c_src, *cc_src, CLASSIFIER / "features.h"]
    if out.exists() and out.stat().st_mtime >= max(p.stat().st_mtime for p in deps):
        return out

    BUILD.mkdir(exist_ok=True)
    flags = [
        "-O2",
        "-fPIC",
        "-DFIXED_POINT=16",
        f"-I{CLASSIFIER}",
        f"-I{MICROFRONTEND}",
        f"-I{KISSFFT}",
        f"-I{KISSFFT / 'tools'}",
    ]
    objs = []
    jobs = [(s, ["cc", "-std=c11"]) for s in c_src]
    jobs += [(s, ["c++", "-std=c++17", "-x", "c++"]) for s in cc_src]
    for src, compiler in jobs:
        obj = BUILD / (src.name + ".o")
        subprocess.run([*compiler, *flags, "-c", str(src), "-o", str(obj)], check=True)
        objs.append(str(obj))
    subprocess.run(["c++", "-shared", *objs, "-o", str(out)], check=True)
    return out


def lib() -> ctypes.CDLL:
    global _lib
    if _lib is None:
        _lib = ctypes.CDLL(str(build()))
        _lib.features_init.restype = ctypes.c_bool
        _lib.serra_clip_features.restype = ctypes.c_size_t
        _lib.serra_clip_features.argtypes = [
            ctypes.c_void_p,
            ctypes.c_size_t,
            ctypes.c_void_p,
            ctypes.c_size_t,
        ]
        _lib.serra_clip_pcm24_to_16.restype = ctypes.c_uint32
        _lib.serra_clip_pcm24_to_16.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t]
        if not _lib.features_init():
            raise RuntimeError("features_init failed")
    return _lib


def extract(pcm16: np.ndarray) -> np.ndarray:
    """All frames for a clip of int16 samples, from a clean state.

    Returns uint8 [frames, CHANNELS]. The model input is the last FRAMES of these.
    """
    pcm16 = np.ascontiguousarray(pcm16, dtype=np.int16)
    max_frames = max(0, (len(pcm16) - WINDOW) // STEP + 1)
    out = np.zeros((max_frames, CHANNELS), dtype=np.uint8)
    n = lib().serra_clip_features(pcm16.ctypes.data, len(pcm16), out.ctypes.data, max_frames)
    return out[:n]


def pcm24_to_16(pcm24: np.ndarray) -> tuple[np.ndarray, int]:
    """Mic samples (signed 24-bit in int32) to feature-extractor samples, as the board does it.

    Returns (int16 samples, peak on the 24-bit scale).
    """
    pcm24 = np.ascontiguousarray(pcm24, dtype=np.int32)
    out = np.zeros(len(pcm24), dtype=np.int16)
    peak = lib().serra_clip_pcm24_to_16(pcm24.ctypes.data, out.ctypes.data, len(pcm24))
    return out, int(peak)


if __name__ == "__main__":
    # Smoke test: a 3 kHz tone should light up the upper-middle channels.
    t = np.arange(SAMPLE_RATE * 2) / SAMPLE_RATE
    tone = (3000 * np.sin(2 * np.pi * 3000 * t)).astype(np.int16)
    f = extract(tone)
    print(f"library: {build()}")
    print(f"2 s of audio -> {f.shape[0]} frames x {f.shape[1]} channels")
    print("loudest channel per frame (first 5):", f[:5].argmax(axis=1))
