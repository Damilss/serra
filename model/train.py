"""Train the Serra classifier, quantize it to int8 and export it for the Pico.

Reads data/features/*.npz (built by dataset.py) and writes:

    out/serra.keras            float model
    out/serra.tflite           int8 model, the one that ships
    out/report.md              test-set results for the int8 model
    out/thresholds.json        minimum score per alert class, chosen on the dev set
    ../firmware/classifier/model_data.{h,cc}   the int8 model as a C array, plus the
                                               class thresholds chosen on the dev set

    uv run train.py
    uv run train.py --epochs 60
"""

from __future__ import annotations

import argparse
import json
from datetime import date

import numpy as np
import tensorflow as tf

from config import ALERT_CLASSES, CLASSES, FEATURES, FIRMWARE_CLASSIFIER, OUT
from features import CHANNELS, FRAMES

# Thresholds are set per alert class as the lowest score that keeps false alerts on the dev
# set at or under this share of non-alert examples (ordinary speech and background).
MAX_FALSE_ALERT_RATE = 0.005
MIN_THRESHOLD = 0.5

# Author line in the header block of the generated firmware sources (model_data.h and .cc),
# which follow the firmware's file-header convention.
C_AUTHOR = "Tobias Halpern <62962933+TobiasH453@users.noreply.github.com>"


def load(split: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    d = np.load(FEATURES / f"{split}.npz")
    # Features are bytes 0-255; the model takes them as 0-1.
    return d["x"].astype(np.float32)[..., None] / 255.0, d["y"].astype(np.int64), d["kind"]


def build_model() -> tf.keras.Model:
    """A small depthwise-separable CNN over the 49 x 40 (time x frequency) feature image.

    Every layer maps to a TFLM built-in with a CMSIS-NN kernel: CONV_2D,
    DEPTHWISE_CONV_2D, MAX_POOL_2D, AVERAGE_POOL_2D, RESHAPE, FULLY_CONNECTED, SOFTMAX.
    """
    L = tf.keras.layers

    def separable(x, filters: int):
        x = L.DepthwiseConv2D(3, padding="same", use_bias=False)(x)
        x = L.BatchNormalization()(x)
        x = L.ReLU()(x)
        x = L.Conv2D(filters, 1, use_bias=False)(x)
        x = L.BatchNormalization()(x)
        return L.ReLU()(x)

    inp = L.Input((FRAMES, CHANNELS, 1), name="features")
    x = L.Conv2D(24, 5, strides=2, padding="same", use_bias=False)(inp)  # 25 x 20
    x = L.BatchNormalization()(x)
    x = L.ReLU()(x)
    x = separable(x, 48)
    x = L.MaxPooling2D(2, padding="same")(x)  # 13 x 10
    x = separable(x, 64)
    x = separable(x, 96)
    x = L.MaxPooling2D(2, padding="same")(x)  # 7 x 5
    x = separable(x, 96)
    x = L.AveragePooling2D((x.shape[1], x.shape[2]))(x)
    x = L.Reshape((x.shape[-1],))(x)
    x = L.Dropout(0.3)(x)
    out = L.Dense(len(CLASSES), activation="softmax", name="scores")(x)
    return tf.keras.Model(inp, out, name="serra")


def mask_augment(x: tf.Tensor, y: tf.Tensor) -> tuple[tf.Tensor, tf.Tensor]:
    """Blank a random band of frequencies and a stretch of time in each example of a batch.

    This is SpecAugment-style masking.
    """
    n = tf.shape(x)[0]
    f0 = tf.random.uniform([n, 1], 0, CHANNELS, dtype=tf.int32)
    fw = tf.random.uniform([n, 1], 0, 6, dtype=tf.int32)
    t0 = tf.random.uniform([n, 1], 0, FRAMES, dtype=tf.int32)
    tw = tf.random.uniform([n, 1], 0, 7, dtype=tf.int32)
    f = tf.range(CHANNELS)[None, :]
    t = tf.range(FRAMES)[None, :]
    keep_f = tf.cast((f < f0) | (f >= f0 + fw), tf.float32)[:, None, :, None]
    keep_t = tf.cast((t < t0) | (t >= t0 + tw), tf.float32)[:, :, None, None]
    return x * keep_f * keep_t, y


def quantize(model: tf.keras.Model, calibration: np.ndarray) -> bytes:
    def representative():
        for i in range(len(calibration)):
            yield [calibration[i : i + 1]]

    # Batch size fixed at 1, as the board runs it. Left open, the converter adds SHAPE,
    # STRIDED_SLICE and PACK ops just to work out the batch size for the reshape.
    inp = tf.keras.Input((FRAMES, CHANNELS, 1), batch_size=1, name="features")
    converter = tf.lite.TFLiteConverter.from_keras_model(tf.keras.Model(inp, model(inp)))
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8
    return converter.convert()


def run_tflite(tflite: bytes, x: np.ndarray) -> np.ndarray:
    """Class scores (0-1) from the int8 model, quantizing the input the way the board will."""
    # TFLite's reference kernels: the ones that give the same scores as CMSIS-NN on the
    # board, bit for bit (board_test.py). The default (XNNPACK) and optimized built-in
    # kernels each round a little differently on some inputs.
    interp = tf.lite.Interpreter(
        model_content=tflite,
        experimental_op_resolver_type=tf.lite.experimental.OpResolverType.BUILTIN_REF,
    )
    interp.allocate_tensors()
    inp, out = interp.get_input_details()[0], interp.get_output_details()[0]
    in_scale, in_zero = inp["quantization"]
    out_scale, out_zero = out["quantization"]
    xq = np.clip(np.round(x / in_scale) + in_zero, -128, 127).astype(np.int8)
    scores = np.zeros((len(x), len(CLASSES)), dtype=np.float32)
    for i in range(len(x)):
        interp.set_tensor(inp["index"], xq[i : i + 1])
        interp.invoke()
        scores[i] = (interp.get_tensor(out["index"])[0].astype(np.float32) - out_zero) * out_scale
    return scores


def pick_thresholds(scores: np.ndarray, y: np.ndarray) -> list[float]:
    """Per alert class: lowest threshold meeting MAX_FALSE_ALERT_RATE on non-alert examples."""
    quiet = y >= len(ALERT_CLASSES)
    thresholds = []
    for c in range(len(ALERT_CLASSES)):
        wins = scores.argmax(axis=1) == c
        false_scores = np.sort(scores[quiet & wins, c])[::-1]
        allowed = int(MAX_FALSE_ALERT_RATE * quiet.sum())
        t = MIN_THRESHOLD
        if len(false_scores) > allowed:
            t = max(t, float(false_scores[allowed]) + 1 / 256)
        thresholds.append(min(t, 0.996))
    return thresholds


def decide(scores: np.ndarray, thresholds: list[float]) -> np.ndarray:
    """What the node does with each window: an alert class index, or -1 for no alert."""
    top = scores.argmax(axis=1)
    best = scores.max(axis=1)
    limit = np.array(thresholds + [2.0] * (len(CLASSES) - len(thresholds)))
    return np.where(best >= limit[top], top, -1)


def report(scores: np.ndarray, y: np.ndarray, kind: np.ndarray, thresholds, size, params) -> str:
    pred = scores.argmax(axis=1)
    lines = [
        "# Classifier report",
        "",
        (
            f"Generated by `train.py` on {date.today()}. Numbers are for the **int8** model on "
            "the held-out test set."
        ),
        "",
        f"- Model: {params:,} parameters, {size:,} bytes as int8 `.tflite`",
        (
            f"- Test examples: {len(y):,} ({int((kind == 'recording').sum()):,} from our own "
            "recordings)"
        ),
        f"- Accuracy (top score, no threshold): {(pred == y).mean():.1%}",
        "",
        "## Confusion matrix",
        "",
        "Rows are the true class, columns the class with the top score.",
        "",
        "| true \\ top | " + " | ".join(CLASSES) + " | recall |",
        "|---|" + "---:|" * (len(CLASSES) + 1),
    ]
    for i, name in enumerate(CLASSES):
        row = [int(((y == i) & (pred == j)).sum()) for j in range(len(CLASSES))]
        recall = row[i] / max(1, sum(row))
        lines.append(f"| {name} | " + " | ".join(map(str, row)) + f" | {recall:.1%} |")

    alert = decide(scores, thresholds)
    quiet = y >= len(ALERT_CLASSES)
    lines += [
        "",
        "## Alerts, with thresholds",
        "",
        (
            "What the node would do, one 1-second window at a time. Thresholds were chosen on "
            f"the dev set to keep false alerts at or under {MAX_FALSE_ALERT_RATE:.1%} of "
            "non-alert windows."
        ),
        "",
        "| class | threshold | caught (right class) | caught (any alert) | missed |",
        "|---|---:|---:|---:|---:|",
    ]
    for i, name in enumerate(ALERT_CLASSES):
        m = y == i
        lines.append(
            f"| {name} | {thresholds[i]:.2f} | {(alert[m] == i).mean():.1%} | "
            f"{(alert[m] >= 0).mean():.1%} | {(alert[m] < 0).mean():.1%} |"
        )
    lines += ["", "False alerts on non-alert windows:", ""]
    for i in range(len(ALERT_CLASSES), len(CLASSES)):
        m = y == i
        lines.append(
            f"- {CLASSES[i]}: {(alert[m] >= 0).mean():.2%} ({int((alert[m] >= 0).sum())} of "
            f"{int(m.sum())})"
        )
    lines.append(f"- all non-alert: {(alert[quiet] >= 0).mean():.2%}")

    lines += [
        "",
        "## By source",
        "",
        "| source | examples | handled correctly |",
        "|---|---:|---:|",
    ]
    for k in sorted(set(kind.tolist())):
        m = kind == k
        want = np.where(y[m] < len(ALERT_CLASSES), y[m], -1)
        lines.append(f"| {k} | {int(m.sum())} | {(alert[m] == want).mean():.1%} |")
    lines.append("")
    return "\n".join(lines)


def export_c(tflite: bytes, thresholds: list[float]) -> None:
    """Write the model and its thresholds as C sources for the firmware."""
    interp = tf.lite.Interpreter(model_content=tflite)
    inp, out = interp.get_input_details()[0], interp.get_output_details()[0]
    ids = "\n".join(f"#define SERRA_MODEL_{name.upper()} {i}" for i, name in enumerate(CLASSES))
    id_docs = "\n".join(
        f" * SERRA_MODEL_{name.upper()} - index of the {name} score" for name in CLASSES
    )
    th = ", ".join(str(min(255, int(np.ceil(t * 256)))) for t in thresholds)
    header = f"""/**
 * author: {C_AUTHOR}
 * date: {date.today()}
 * file: model_data.h
 *
 * generated by model/train.py. do not edit: retrain instead.
 *
 * the int8 TensorFlow Lite model and the numbers firmware needs to run it.
 */
#ifndef CLASSIFIER_MODEL_DATA_H
#define CLASSIFIER_MODEL_DATA_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {{
#endif

/**
 * SERRA_MODEL_INPUT_FRAMES - frames in one model input
 * SERRA_MODEL_INPUT_CHANNELS - filterbank channels per frame
 *
 * input: int8 [1, {FRAMES}, {CHANNELS}, 1], oldest frame first. a feature byte b (0-255,
 * from features_process) goes in as b - 128. checked against the model's own input
 * quantization (scale {inp["quantization"][0]:.8f}, zero point {inp["quantization"][1]}).
 */
#define SERRA_MODEL_INPUT_FRAMES {FRAMES}
#define SERRA_MODEL_INPUT_CHANNELS {CHANNELS}

/**
 * SERRA_MODEL_CLASSES - number of output scores, one per class
{id_docs}
 *
 * output: int8 [1, {len(CLASSES)}] scores, in this order. score = (value + 128) / 256
 * (scale {out["quantization"][0]:.8f}, zero point {out["quantization"][1]}).
 */
#define SERRA_MODEL_CLASSES {len(CLASSES)}
{ids}

/**
 * SERRA_MODEL_ALERT_CLASSES - number of alert classes (whistle, scream, help)
 * SERRA_MODEL_THRESHOLDS - per alert class, the minimum output value + 128 (so 0-255)
 *                          that counts as a detection
 *
 * the class must also have the top score. chosen on the dev set.
 */
#define SERRA_MODEL_ALERT_CLASSES {len(ALERT_CLASSES)}
#define SERRA_MODEL_THRESHOLDS {{{th}}}

/**
 * serra_model_data - the int8 model as a TensorFlow Lite flatbuffer
 *
 * aligned to 16 bytes for TFLM, which reads the flatbuffer in place from flash.
 */
extern const unsigned char serra_model_data[];

/**
 * serra_model_data_len - size of serra_model_data in bytes
 */
extern const unsigned int serra_model_data_len;

#ifdef __cplusplus
}}
#endif

#endif /* CLASSIFIER_MODEL_DATA_H */
"""
    rows = [
        "\t" + ", ".join(f"0x{b:02x}" for b in tflite[i : i + 12]) + ","
        for i in range(0, len(tflite), 12)
    ]
    source = (
        f"""/**
 * author: {C_AUTHOR}
 * date: {date.today()}
 * file: model_data.cc
 *
 * generated by model/train.py. do not edit: retrain instead.
 *
 * the int8 model as a C array. see model_data.h.
 */
#include "model_data.h"

/**
 * serra_model_data - the int8 model as a TensorFlow Lite flatbuffer
 *
 * aligned for TFLM, which reads the flatbuffer in place from flash.
 */
"""
        "alignas(16) const unsigned char serra_model_data[] = {\n" + "\n".join(rows) + "\n};\n\n"
        f"const unsigned int serra_model_data_len = {len(tflite)};\n"
    )
    (FIRMWARE_CLASSIFIER / "model_data.h").write_text(header)
    (FIRMWARE_CLASSIFIER / "model_data.cc").write_text(source)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    tf.keras.utils.set_random_seed(args.seed)
    x_train, y_train, _ = load("train")
    x_dev, y_dev, _ = load("dev")
    x_test, y_test, kind_test = load("test")

    model = build_model()
    model.summary()

    steps = int(np.ceil(len(x_train) / args.batch))
    schedule = tf.keras.optimizers.schedules.CosineDecay(2e-3, steps * args.epochs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(schedule),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=["accuracy"],
    )
    train = (
        tf.data.Dataset.from_tensor_slices((x_train, y_train))
        .shuffle(len(x_train), seed=args.seed)
        .batch(args.batch)
        .map(mask_augment, num_parallel_calls=tf.data.AUTOTUNE)
        .prefetch(tf.data.AUTOTUNE)
    )
    # Even out class sizes so no class is learned at another's expense.
    counts = np.bincount(y_train, minlength=len(CLASSES))
    weights = {i: float(len(y_train) / (len(CLASSES) * c)) for i, c in enumerate(counts)}
    model.fit(
        train,
        validation_data=(x_dev, y_dev),
        epochs=args.epochs,
        class_weight=weights,
        verbose=2,
    )

    OUT.mkdir(exist_ok=True)
    model.save(OUT / "serra.keras")

    rng = np.random.default_rng(args.seed)
    calibration = x_train[rng.choice(len(x_train), 500, replace=False)]
    tflite = quantize(model, calibration)
    (OUT / "serra.tflite").write_bytes(tflite)

    thresholds = pick_thresholds(run_tflite(tflite, x_dev), y_dev)
    text = report(
        run_tflite(tflite, x_test), y_test, kind_test, thresholds, len(tflite), model.count_params()
    )
    (OUT / "report.md").write_text(text)
    (OUT / "thresholds.json").write_text(
        json.dumps(dict(zip(ALERT_CLASSES, thresholds, strict=True)), indent=2) + "\n"
    )
    export_c(tflite, thresholds)
    print("\n" + text)


if __name__ == "__main__":
    main()
