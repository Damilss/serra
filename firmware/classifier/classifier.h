/**
 * author: Tobias Halpern <62962933+TobiasH453@users.noreply.github.com>
 * date: 2026-11-14
 * file: classifier.h
 *
 * the Serra classifier: mic samples in, alerts out.
 *
 * wraps the feature code (features.h), the int8 model (model_data.h) and
 * TensorFlow Lite Micro behind a plain C API, so firmware never touches C++
 * or the model's tensors. see docs/classifier-interface.md.
 *
 * call everything from one core. nothing here blocks; classifier_poll() runs
 * at most one inference per call.
 *
 *     classifier_init(calib);
 *     for (;;) {
 *         size_t n = mic_read(samples, MAX);
 *         classifier_push(samples, n);
 *         classifier_result_t r;
 *         if (classifier_poll(&r)) { ... send the alert ... }
 *     }
 */
#ifndef CLASSIFIER_CLASSIFIER_H
#define CLASSIFIER_CLASSIFIER_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * CLASS_WHISTLE - classifier_result_t.class_id for a whistle
 * CLASS_SCREAM - classifier_result_t.class_id for a scream
 * CLASS_HELP - classifier_result_t.class_id for the spoken word "help"
 */
#define CLASS_WHISTLE 1
#define CLASS_SCREAM 2
#define CLASS_HELP 3

/**
 * classifier_result_t - one detected event
 * @class_id: CLASS_WHISTLE, CLASS_SCREAM or CLASS_HELP
 * @confidence: 0-255: the model's best score for that class during the event
 * @peak_level: tenths of a dB: loudest moment in dBFS plus the calibration
 *              offset
 * @blast_count: whistles: blasts heard in the event (3 = distress); otherwise 0
 *
 * fields match alert_payload_t (project README, Mesh protocol).
 */
typedef struct {
	uint8_t class_id;
	uint8_t confidence;
	int16_t peak_level;
	uint8_t blast_count;
} classifier_result_t;

/**
 * classifier_init - load the model and reset all state; call once at boot
 * @calib_offset_db_x10: this node's calibration offset in tenths of a dB,
 *                       added to every peak_level
 *
 * return: false if the model can't be loaded (wrong format, arena too small,
 * out of heap for the feature tables).
 */
bool classifier_init(int16_t calib_offset_db_x10);

/**
 * classifier_push - feed mic audio as it arrives
 * @samples24: 16 kHz, signed 24-bit samples in int32_t, as mic_read()
 *             returns them
 * @n: samples in @samples24
 *
 * computes features as it goes; does not run the model.
 */
void classifier_push(const int32_t *samples24, size_t n);

/**
 * classifier_poll - run the model when a step is due and report finished events
 * @out: filled in when an event is reported
 *
 * call often. runs the model when ~240 ms of new audio has arrived and the
 * audio is loud enough to bother (the wake trigger). an event is reported
 * when it ends, roughly 1.5 s after the sound stops, so that its peak level
 * and blast count cover the whole of it; a sound that keeps going is
 * reported every few seconds.
 *
 * return: true once per detected event, with *@out filled in.
 */
bool classifier_poll(classifier_result_t *out);

/* ---- measurement and test hooks, not needed by the node firmware ---- */

/**
 * classifier_stats_t - counters and latest values for measurement
 * @arena_size: bytes reserved for TFLM's working memory
 * @arena_used: bytes of it the model needs
 * @inferences: model runs since init
 * @windows: 240 ms steps since init (inferences + steps skipped as quiet)
 * @last_infer_us: duration of the latest model run
 * @scores: latest scores, 0-255, in model_data.h order
 * @level: peak level of the latest 240 ms, tenths of a dB, calibrated
 */
typedef struct {
	uint32_t arena_size;
	uint32_t arena_used;
	uint32_t inferences;
	uint32_t windows;
	uint32_t last_infer_us;
	uint8_t scores[5];
	int16_t level;
} classifier_stats_t;

/**
 * classifier_get_stats - copy out the current classifier_stats_t
 * @out: where the stats go
 */
void classifier_get_stats(classifier_stats_t *out);

/**
 * classifier_infer_features - run the model on a given feature window
 * @features: 49 x 40 bytes, oldest frame first
 * @scores: the model's 5 scores, 0-255, in model_data.h order
 *
 * uses @features instead of the live audio, for checking the board against
 * the PC.
 *
 * return: false if the model failed.
 */
bool classifier_infer_features(const uint8_t *features, uint8_t scores[5]);

#ifdef __cplusplus
}
#endif

#endif /* CLASSIFIER_CLASSIFIER_H */
