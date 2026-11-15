"""Synthetic audio: whistles to bootstrap the whistle class, and noise for backgrounds.

Synthetic whistles stand in until we have real takes through the INMP441. They cover the
ground a real whistle covers (pea whistles with a trill, pealess multi-tone whistles, mouth
whistling) so the first model has something to learn, but real recordings should replace
most of them: see README.md.

All signals are float32 at 16 kHz, roughly within [-1, 1].
"""

from __future__ import annotations

import numpy as np
from scipy import signal

from config import CLIP, SAMPLE_RATE


def _envelope(n: int, rng: np.random.Generator) -> np.ndarray:
    attack = int(rng.uniform(0.005, 0.05) * SAMPLE_RATE)
    release = int(rng.uniform(0.02, 0.10) * SAMPLE_RATE)
    attack, release = min(attack, n // 2), min(release, n // 2)
    env = np.ones(n, dtype=np.float32)
    env[:attack] = np.linspace(0, 1, attack, dtype=np.float32) ** 2
    env[n - release :] = np.linspace(1, 0, release, dtype=np.float32) ** 2
    # Breath pressure is never steady: slow wobble in loudness.
    wobble = 1 + rng.uniform(0, 0.15) * np.sin(
        2 * np.pi * rng.uniform(1, 6) * np.arange(n) / SAMPLE_RATE + rng.uniform(0, 6.28)
    )
    return env * wobble.astype(np.float32)


def whistle_blast(duration: float, rng: np.random.Generator) -> np.ndarray:
    """One whistle blast."""
    n = int(duration * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    kind = rng.choice(["pea", "pealess", "mouth"], p=[0.45, 0.35, 0.20])

    if kind == "mouth":
        f0 = rng.uniform(900, 2600)
    else:
        f0 = rng.uniform(1900, 4600)

    # Pitch: a short rise as the blast starts, then slow drift.
    glide = 1 - rng.uniform(0, 0.08) * np.exp(-t / rng.uniform(0.01, 0.05))
    drift = 1 + rng.uniform(0, 0.02) * np.sin(2 * np.pi * rng.uniform(0.5, 4) * t)
    if kind == "mouth" and rng.random() < 0.5:
        drift *= 1 + rng.uniform(-0.25, 0.25) * t / max(duration, 1e-3)  # sliding note
    freq = f0 * glide * drift

    am = np.ones(n)
    if kind == "pea":
        # The pea interrupts the air stream: a trill in both pitch and loudness.
        rate = rng.uniform(18, 75)
        phase = rng.uniform(0, 6.28)
        freq = freq + rng.uniform(20, 220) * np.sin(2 * np.pi * rate * t + phase)
        am = 1 - rng.uniform(0.2, 0.85) * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t + phase + 1))

    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    x = np.sin(phase)
    for k, level_db in ((2, rng.uniform(-40, -12)), (3, rng.uniform(-45, -18))):
        if f0 * k < SAMPLE_RATE / 2 - 300:
            x += 10 ** (level_db / 20) * np.sin(k * phase + rng.uniform(0, 6.28))

    if kind == "pealess":
        # Pealess whistles sound two or three close tones that beat against each other.
        for _ in range(rng.integers(1, 3)):
            ratio = 1 + rng.uniform(0.03, 0.22) * rng.choice([-1, 1])
            x += rng.uniform(0.4, 1.0) * np.sin(ratio * phase + rng.uniform(0, 6.28))

    x *= am
    # Air noise around the whistle's pitch.
    breath = rng.standard_normal(n)
    lo, hi = max(300, f0 * 0.5), min(SAMPLE_RATE / 2 - 200, f0 * 2.0)
    sos = signal.butter(2, [lo, hi], btype="band", fs=SAMPLE_RATE, output="sos")
    x += 10 ** (rng.uniform(-38, -14) / 20) * signal.sosfilt(sos, breath)

    x = x.astype(np.float32) * _envelope(n, rng)
    return x / (np.abs(x).max() + 1e-9)


def whistle_clip(rng: np.random.Generator) -> np.ndarray:
    """A 1-second clip holding one whistle blast, or the start, end or middle of one."""
    duration = rng.uniform(0.25, 1.6)
    blast = whistle_blast(duration, rng)
    clip = np.zeros(CLIP, dtype=np.float32)
    # Keep at least 250 ms of the blast inside the window.
    start = int(rng.integers(-(len(blast) - 4000), CLIP - 4000 + 1))
    src0, dst0 = max(0, -start), max(0, start)
    n = min(len(blast) - src0, CLIP - dst0)
    clip[dst0 : dst0 + n] = blast[src0 : src0 + n]
    return clip


def chirps_clip(rng: np.random.Generator) -> np.ndarray:
    """Short high-pitched chirps and beeps: bird-like sounds that are NOT a whistle blast.

    Each one is under 120 ms, well short of a deliberate blast. They go to the background
    class so the model keys on a sustained tone, not on any energy at whistle pitch.
    """
    clip = np.zeros(CLIP, dtype=np.float32)
    for _ in range(rng.integers(1, 7)):
        n = int(rng.uniform(0.02, 0.12) * SAMPLE_RATE)
        t = np.arange(n) / SAMPLE_RATE
        f_start, f_end = rng.uniform(1500, 6500, size=2)
        freq = np.linspace(f_start, f_end, n)
        x = np.sin(2 * np.pi * np.cumsum(freq) / SAMPLE_RATE) * np.hanning(n)
        x *= 1 + 0.5 * np.sin(2 * np.pi * rng.uniform(20, 120) * t)
        start = int(rng.integers(0, CLIP - n))
        clip[start : start + n] += (rng.uniform(0.3, 1.0) * x).astype(np.float32)
    return clip / (np.abs(clip).max() + 1e-9)


def coloured_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    """White, pink or brown noise, or wind-like rumble, at unit RMS."""
    white = rng.standard_normal(n + 1024)
    kind = rng.choice(["white", "pink", "brown", "wind"])
    if kind == "white":
        x = white
    else:
        spectrum = np.fft.rfft(white)
        f = np.fft.rfftfreq(len(white), 1 / SAMPLE_RATE)
        f[0] = f[1]
        spectrum *= {"pink": f**-0.5, "brown": f**-1.0, "wind": f**-1.5}[kind]
        x = np.fft.irfft(spectrum, len(white))
        if kind == "wind":
            # Gusts: slow random swell in loudness.
            gust = np.interp(
                np.arange(len(x)),
                np.linspace(0, len(x), 8),
                rng.uniform(0.2, 1.0, size=8),
            )
            x = x * gust
    x = x[512 : 512 + n].astype(np.float32)
    return x / (np.sqrt(np.mean(x**2)) + 1e-9)
