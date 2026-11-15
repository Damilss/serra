/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: ipc.c
 */
#include "ipc.h"

#include <stdio.h>

#include "mesh/mesh.h"
#include "pico/async_context.h"
#include "pico/cyw43_arch.h"
#include "pico/util/queue.h"

/**
 * IPC_QUEUE_LEN - detections that can wait for core 0 at once
 *
 * the classifier reports at most one event every second or so, and core 0
 * drains the queue on its next loop pass, so 8 is plenty.
 */
#define IPC_QUEUE_LEN 8

static queue_t detections;

/**
 * to_alert - turn a detection into the mesh's alert payload
 * @det: the detection from core 1
 * @alert: filled in
 */
static void to_alert(const ipc_detection_t *det, alert_payload_t *alert) {
	*alert = (alert_payload_t){
		.class_id = det->class_id,
		.confidence = det->confidence,
		.peak_level = det->peak_level,
		.timestamp = det->timestamp_ms,
		.blast_count = det->blast_count,
	};
}

/**
 * drain - when-pending worker on core 0: send every queued detection
 * @context: the cyw43 async_context
 * @worker: this worker
 *
 * runs on core 0 inside cyw43_arch_poll(), after core 1 marked it pending.
 */
static void drain(async_context_t *context, async_when_pending_worker_t *worker) {
	(void)context;
	(void)worker;
	ipc_detection_t det;
	alert_payload_t alert;

	while (queue_try_remove(&detections, &det)) {
		to_alert(&det, &alert);
		if (mesh_send_alert(&alert) == 0)
			printf("[ipc] alert class=%u conf=%u peak=%d blasts=%u ts=%lu\n", alert.class_id,
				   alert.confidence, alert.peak_level, alert.blast_count,
				   (unsigned long)alert.timestamp);
		else
			printf("[ipc] mesh rejected alert class=%u\n", alert.class_id);
	}
}

static async_when_pending_worker_t drain_worker = {
	.do_work = drain,
};

/**
 * ipc_init - set up the detections queue and core 0's worker
 *
 * return: 0 on success, -1 if the async_context rejected the worker.
 */
int ipc_init(void) {
	queue_init(&detections, sizeof(ipc_detection_t), IPC_QUEUE_LEN);
	return async_context_add_when_pending_worker(cyw43_arch_async_context(), &drain_worker) ? 0
																							: -1;
}

/**
 * ipc_post - hand a detection from core 1 to core 0
 * @det: the detection; copied
 *
 * queue_t is safe across cores, and async_context_set_work_pending() may be
 * called from any context (SDK docs), so this is all core 1 needs.
 *
 * return: true if queued, false if the queue was full and @det was dropped.
 */
bool ipc_post(const ipc_detection_t *det) {
	if (!queue_try_add(&detections, det)) {
		printf("[ipc] queue full, detection dropped\n");
		return false;
	}
	async_context_set_work_pending(cyw43_arch_async_context(), &drain_worker);
	return true;
}
