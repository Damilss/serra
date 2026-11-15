# Training data

Nothing in this folder is committed except this file. Everything can be re-created:

```sh
cd model
uv run fetch_mswc.py      # "help" + other speech, ~1.7 GB download, ~0.5 GB kept
uv run fetch_sounds.py    # screams + background noise, ~3.3 GB download, ~2.7 GB kept
```

## Sources and licenses

| Folder | Dataset | Used for | License |
|---|---|---|---|
| `mswc/` | [Multilingual Spoken Words Corpus](https://mlcommons.org/datasets/multilingual-spoken-words/) (MLCommons), English, via its [Hugging Face mirror](https://huggingface.co/datasets/MLCommons/ml_spoken_words). Six of the 112 shards: the three that contain "help", plus three more for variety | `help`, `other_speech` | CC-BY 4.0 |
| `nonspeech7k/` | [Nonspeech7k](https://zenodo.org/records/6967442) (Rashid, Li, Du) | "screaming" → `scream`; breath, cough, crying, laugh, sneeze, yawn → `background` | CC-BY 4.0 |
| `demand/` | [DEMAND](https://zenodo.org/records/1227121) (Thiemann, Ito, Vincent): park, field, river, traffic, town square, living room, office, meeting room, hallway, cafeteria. Channel 1 of the 16 kHz version | background noise mixed under every example, and `background` on its own | CC-BY 4.0 |
| (none) | Synthetic whistles, chirps and coloured noise from `synth.py` | `whistle`, `background` | ours |

All three are CC-BY: credit them wherever the model is published.

## Our own recordings

`uv run record.py <class>` records through the INMP441 and saves here (see [the model README](../README.md#recording-through-the-mic)). Files from any other recorder work too: put takes in `recordings/<class>/`, where `<class>` is `whistle`, `scream`, `help`, `other_speech` or `background`:

```
data/recordings/
├── whistle/2026-11-14-fox40-5m.wav
├── help/sam-across-room.wav
└── background/demo-room.wav
```

- **Format:** WAV, mono, 16 kHz. A file can be any length and hold many takes; `dataset.py` cuts it up (one window per burst of sound for whistle / scream / help, the whole file for background).
- **24-bit files are treated as raw INMP441 audio** (the signed 24-bit samples the node reads, `word >> 8`) and go through the same DC-removal and gain code the board runs. **16-bit files** (a laptop or phone mic) are used as they are.
- Leave a second or two of quiet between takes, and a few seconds of room tone at the start.
- Files, not seconds, are assigned to train / dev / test: within each class, in time order, every third-of-five take is test and every fifth is dev. So record several files per class; a class needs at least three before it has a test take. One file per person or per session is a good unit: it keeps one voice from landing on both sides.
- Get consent before recording anyone ([CONTRIBUTING](../../CONTRIBUTING.md#data-and-recordings)).

Then rebuild: `uv run dataset.py && uv run train.py`.
