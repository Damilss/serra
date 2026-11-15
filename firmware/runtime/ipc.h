/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan, <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: ipc.h
 *
 * the glue between core 0 and core 1, detections queue.
 * Handling core 1 -> core 0 wakeup.
 *
 * core 1 (audio + classifier) calls ipc_post() for each detection. that
 * puts it on a queue_t and marks a when-pending worker on core 0's cyw43
 * async_context, so core 0 wakes, takes it off the queue and sends it over
 * the mesh as an alert. core 1 never touches BTstack or the mesh.
 *
 * ipc_detection_t carries only the classifier's fields; core 0 turns it
 * into the mesh's alert_payload_t (ipc.c), so core 1 doesn't depend on the
 * wire format.
 */
#ifndef RUNTIME_IPC_H
#define RUNTIME_IPC_H
#include <stdbool.h>
#include <stdint.h>

/**
 * ipc_detection_t - one detection, as handed from core 1 to core 0
 * @class_id: alert_class_t value (1 whistle, 2 scream, 3 help)
 * @confidence: classifier confidence, 0-255
 * @peak_level: calibrated peak loudness in tenths of a dB
 * @blast_count: whistles only, 3 = distress pattern; 0 otherwise
 * @timestamp_ms: when core 1 reported it, ms since boot
 *
 * the alert_payload_t fields, minus anything the mesh adds.
 */
typedef struct ipc_detection {
	uint8_t class_id;
	uint8_t confidence;
	int16_t peak_level;
	uint8_t blast_count;
	uint32_t timestamp_ms;
} ipc_detection_t;

/**
 * ipc_init - set up the detections queue and core 0's worker
 *
 * call on core 0 after cyw43_arch_init() and mesh_init(), before core 1
 * starts posting.
 *
 * return: 0 on success, -1 if the async_context rejected the worker.
 */
int ipc_init(void);

/**
 * ipc_post - hand a detection from core 1 to core 0
 * @det: the detection; copied
 *
 * never blocks. safe from core 1 (and from an interrupt).
 *
 * return: true if queued, false if the queue was full and @det was dropped.
 */
bool ipc_post(const ipc_detection_t *det);

#endif /* RUNTIME_IPC_H */
