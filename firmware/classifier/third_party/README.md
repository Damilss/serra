# Third-party code

Vendored unmodified. Don't reformat or edit these; update by copying a newer upstream version.

| Folder | What | Source | License |
|---|---|---|---|
| `microfrontend/` | TFLM audio "microfrontend": window, FFT, mel filterbank, noise reduction, PCAN gain control, log scale. The `*_io.c`, `*_main.c` and memmap files are left out | [tensorflow/tensorflow](https://github.com/tensorflow/tensorflow/tree/master/tensorflow/lite/experimental/microfrontend/lib), commit `ff39a90d22a5` | Apache-2.0 (`microfrontend/LICENSE`) |
| `kissfft/` | KISS FFT, the FFT the microfrontend calls. Built with `FIXED_POINT=16` | Copied from [pico-tflmicro](https://github.com/raspberrypi/pico-tflmicro) `src/third_party/kissfft`, commit `dfea53b` | BSD-3-Clause (`kissfft/COPYING`) |

Both are compiled twice: into the node firmware, and into a host shared library by `model/features.py`, so training and the board compute identical features.
