# model

Training pipeline for the Serra classifier: the on-device model that tells a **whistle**, a **scream** and a shouted **"help"** apart from ordinary speech and background noise. See the [project README](../README.md#audio-classifier-pipeline) for why these classes, and [docs/classifier-interface.md](../docs/classifier-interface.md) for the handoff to firmware.

Latest results: third model, trained 2026-11-14 on public datasets, synthetic whistles and our first recordings through the INMP441: 43 takes (about 19 minutes) from two people, in a coffee shop and the demo room. On-board timing was measured with the first model, which has the same architecture.

| | |
|---|---|
| Size | 24,997 parameters, **47 KB** as an int8 `.tflite` |
| On a Pico 2 W | **70.6 ms** per inference, **42.9 KB** TFLM arena, 0.75 ms of feature code per 20 ms frame |
| Test accuracy (int8, single 1-second windows) | 93.6% |
| Our own held-out takes, events that raised an alert | whistle 15 of 15, scream 29 of 29, "help" 11 of 11 (7 as help, 4 as another alert class). The first model: 15, 14 and 6 |
| Simulated live stream, events caught | whistle 86 of 86, "help" 78 of 98 (80%), scream 81 of 93 (87%) |
| Simulated live stream, false alerts | ordinary speech: 4 of 104 words. Coughs, laughs and crying: 20 of 97 |

Full numbers: `out/report.md` and `out/stream_report.md` after a training run. Read [Known gaps](#known-gaps) before trusting them.

---

## Quick start

```sh
cd model
uv sync                    # Python 3.11 + TensorFlow
uv run fetch_mswc.py       # "help" and other speech   (~1.7 GB download)
uv run fetch_sounds.py     # screams and background    (~3.3 GB download)
uv run dataset.py          # audio -> features, data/features/*.npz   (~2 min)
uv run train.py            # train, quantize, test, export             (~13 min)
uv run stream_test.py      # test on a simulated live stream           (~1 min)
```

`train.py` writes:

| File | What |
|---|---|
| `out/serra.tflite` | The int8 model that ships |
| `out/report.md` | Test-set results for that int8 model: confusion matrix, alerts caught and missed, false alerts |
| `out/thresholds.json` | Minimum score for each alert class |
| `../firmware/classifier/model_data.{h,cc}` | The same model as a C array, with the thresholds and input / output layout as `#define`s. These two are committed, so firmware builds without running any Python |

A host C compiler (`cc`, `c++`) is needed: the pipeline compiles the firmware's feature code for your machine (see below). Xcode command line tools or `build-essential` is enough.

Try the model on any recording:

```sh
uv run predict.py take.wav         # prints the windows that would raise an alert
uv run predict.py take.wav --all   # every window with its top class and score
```

---

## How it works

```
16 kHz audio ──> features (C, shared with firmware) ──> 49 x 40 image ──> small CNN ──> 5 scores
                 30 ms windows every 20 ms,              1 second          int8
                 40 filterbank channels
```

### One feature implementation, used twice

The model doesn't see audio; it sees a 49 × 40 picture of one second of sound (49 time steps, 40 frequency bands from 125 Hz to 7.5 kHz). That picture is computed by TFLM's audio "microfrontend", the `micro_speech` recipe, wrapped in [`firmware/classifier/features.c`](../firmware/classifier/features.c).

`features.py` compiles that same C file into a shared library and calls it from Python. So the features used in training are computed by the code that runs on the Pico, bit for bit. There is no second, Python implementation that could drift.

`features.c` also holds the mic conversion: the INMP441's signed 24-bit samples lose their DC offset, get a fixed +12 dB of gain and are saturated to 16 bits. Recordings made through the mic go through this in training too.

### What a training example is

The feature code adapts to what it has just heard (it tracks the noise floor and evens out loudness per band), and a node is always listening. So every example is built as three seconds: two seconds of background noise as lead-in, then one second of the sound mixed over more of that noise. Features come from the last second. Levels are randomised to cover a call from far away up to a whistle right next to the node, over anything from near silence to a noisy room.

A node also slides its window along a live stream, so it sees more than neatly centred sounds: the moment just after a word ends, or a window that catches only the last sliver of one. A share of examples are built that way and labelled `background`. Without them the first model raised false whistle alerts right after speech stopped.

### The model

A depthwise-separable CNN: one 5×5 convolution, four depthwise + pointwise blocks, average pooling, one dense layer. It uses only layers that TFLM runs with CMSIS-NN kernels (`CONV_2D`, `DEPTHWISE_CONV_2D`, `MAX_POOL_2D`, `AVERAGE_POOL_2D`, `FULLY_CONNECTED`, `SOFTMAX`). It is exported with the batch size fixed at 1; left open, the converter adds three more op types the board would have to carry.

Scores are computed with TFLite's reference kernels, because those match the board's CMSIS-NN kernels bit for bit; the default XNNPACK delegate and the optimized built-in kernels each round slightly differently on some inputs. So every number in the reports is what the Pico would output for the same features.

Output order is fixed in `config.py`: `whistle, scream, help, other_speech, background`. The first three are alerts; firmware's `class_id` is the index + 1.

### Thresholds

A window raises an alert when an alert class has the top score **and** that score clears the class's threshold. `train.py` picks each threshold on the dev set as the lowest value that keeps false alerts at or under 0.5% of non-alert windows (`MAX_FALSE_ALERT_RATE`), with a floor of 0.5. Lower thresholds catch more calls and raise more false alarms; that constant is the knob.

---

## Data

Sources, licenses and how to add recordings are in [`data/README.md`](data/README.md). In short:

| Class | Comes from |
|---|---|
| `whistle` | **Synthetic** blasts from `synth.py`, until we have real takes |
| `scream` | Nonspeech7k "screaming" |
| `help` | Spoken Words Corpus "help" |
| `other_speech` | Spoken Words Corpus, ~4,000 other words |
| `background` | DEMAND noise; Nonspeech7k coughs, laughs, breathing, crying; synthetic noise and chirps |

**Adding our own recordings** is the single biggest improvement available: drop WAV files into `data/recordings/<class>/` and re-run `dataset.py` and `train.py`. They are weighted up (12 augmented copies each in training) and reported separately in `out/report.md`.

---

## Recording through the mic

`firmware/tools/mic_capture` is a small firmware that streams the INMP441 to the PC over USB, and `record.py` saves it. It is a separate build from the node firmware and links no radio code.

**Wire the mic** ([classifier-interface.md](../docs/classifier-interface.md#1-microphone-inmp441)): `SD` → GP2, `SCK` → GP3, `WS` → GP4, `L/R` → GND, `VDD` → 3V3(OUT), `GND` → GND.

**Build and flash** (needs the firmware toolchain, `scripts/install-firmware-tooling.sh`):

```sh
cmake -S firmware/tools/mic_capture -B firmware/tools/mic_capture/build -G Ninja
cmake --build firmware/tools/mic_capture/build
# hold BOOTSEL while plugging the Pico in, then:
picotool load -x firmware/tools/mic_capture/build/mic_capture.uf2
```

**Record:**

```sh
cd model
uv run dev_ui.py                                    # browser page: one start/stop button, live test
uv run record.py --monitor                          # level meter only: does the mic work?
uv run record.py whistle --name fox40-5m            # Ctrl-C to stop
uv run record.py help --seconds 60 --name sam-3m
uv run record.py background --seconds 120 --name demo-room
```

Takes land in `data/recordings/<class>/` as 24-bit WAV. Then `uv run dataset.py && uv run train.py`.

Reading the meter: the level depends a lot on the room, because the mic picks up low rumble (below ~100 Hz) that the classifier ignores. A busy coffee shop read about -50 dBFS RMS; a quiet room will be well below that (not measured yet). What matters is that the level moves: a clap or whistle should make the bar jump. A flat 0 or a stuck value means wiring; the interface doc has a note on clone mics that need a faster clock. `CLIPPING` means the sound overloaded the mic itself: move back.

Tips: several short files beat one long one (files, not seconds, are split into train / dev / test). Leave a second of quiet between takes. Vary distance, direction and who is calling.

---

## Files

| File | What |
|---|---|
| `config.py` | Class list and paths |
| `fetch_mswc.py`, `fetch_sounds.py` | Download the datasets |
| `features.py`, `features_host.c` | Python binding for the firmware's feature code |
| `synth.py` | Synthetic whistles, chirps and noise |
| `dataset.py` | Builds `data/features/{train,dev,test}.npz` |
| `train.py` | Trains, quantizes, tests and exports |
| `record.py` | Records through the INMP441 from a Pico running `mic_capture` |
| `dev_ui.py` | Browser page for the same thing with one start/stop button, plus a live test of the classifier on the Pico. Flashes the firmware it needs |
| `predict.py` | Runs the int8 model over a recording |
| `stream_test.py` | Tests the int8 model on a simulated live stream: events caught, false alerts per hour |
| `board_test.py` | Reads arena size and timing from a Pico running `firmware/tools/classifier_bench`, checks its scores against the PC, and prints what it hears live. Building `classifier_bench` needs TensorFlow Lite Micro (`pico-tflmicro`), which `scripts/install-firmware-tooling.sh` installs; `mic_capture` and training don't |

---

## Known gaps

- **Our own takes are few and from one session.** Two voices, one whistle, mostly one distance; the held-out takes share all of that with the training takes, so the real-take numbers above are optimistic. Whistles are the thinnest: 4 takes, the rest synthetic. More people, distances and three-blast patterns are the next thing to record.
- **Screams and shouted "help" blur into each other** in both directions (some takes contain both). Either way an alert is raised; only the class label is affected.
- **False alerts rose with the third model**: 39 in the 30-minute stream test against 27 for the first. It leans toward calling loud voices a scream (threshold 0.72, was 0.84).
- **The mic driver and `mic_capture` work** (checked 2026-11-14: no dropped samples, a 1 kHz tone reads 1000 Hz, sample rate 16,000 Hz). Most speech and screams still come from laptop, phone and studio mics. The mic conversion in `features.c` (DC removal, +12 dB, `FEATURES_PCM24_SHIFT`) is a reasoned guess at the right gain and has not been checked against real calls at a distance.
- **"help" is read, not shouted.** The corpus clips are people reading the word. Its threshold had to go to 0.96 to keep ordinary speech quiet, which costs recall on those clips: 80% of events in the stream test (the first model got 86%; this number moves several points between training runs). Our own shouted takes do much better. In-room shouted takes should help most here.
- **Crying and laughing set off `scream`.** About one in five such sounds raised an alert in the stream test. There are only ~590 scream clips, and loud crying is close to screaming. More scream data, and a decision on whether crying *should* alert, are open.
- **On the board, only the model is verified.** `firmware/classifier/classifier.cc` runs it on a Pico 2 W with scores identical to the PC. The logic around it (wake trigger level, grouping windows into one event, blast counting) is written but tuned on synthetic audio only, and has not been tested against real whistles or shouts. In a noisy coffee shop the wake trigger was open 86% of the time and the first model raised false `scream` alerts on the chatter. `dev_ui.py` has a live test page for trying this.
- **70.6 ms per inference** is more than the interface doc's early "tens of ms" guess: about 30% of one core while sound is present. Untried speed-ups: running the kernels from RAM instead of flash, a smaller first layer.
- **Small scream test set** (42 clips), so the scream numbers move a few points between runs.
