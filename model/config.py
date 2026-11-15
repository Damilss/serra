"""Shared constants for the training pipeline."""

from pathlib import Path

MODEL_DIR = Path(__file__).parent
DATA = MODEL_DIR / "data"
OUT = MODEL_DIR / "out"
FIRMWARE_CLASSIFIER = MODEL_DIR.parent / "firmware" / "classifier"

# Output order of the model. The first three raise alerts; firmware maps them to
# CLASS_WHISTLE = 1, CLASS_SCREAM = 2, CLASS_HELP = 3 (index + 1).
CLASSES = ["whistle", "scream", "help", "other_speech", "background"]
ALERT_CLASSES = CLASSES[:3]

SAMPLE_RATE = 16000
CLIP = SAMPLE_RATE  # samples in one model input (1 second)

# Where our own takes go: data/recordings/<class>/*.wav, 16 kHz mono, as written by
# record.py (24-bit, straight from the INMP441) or any other 16-bit / 24-bit WAV.
RECORDINGS = DATA / "recordings"
FEATURES = DATA / "features"
