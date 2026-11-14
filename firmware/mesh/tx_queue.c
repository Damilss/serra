/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: tx_queue.c
 */
#include "tx_queue.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "ble.h"
#include "packet.h"
#include "pico/async_context.h"
#include "pico/cyw43_arch.h"
#include "pico/time.h"

/**
 * TXQ_SLOTS - packets the queue holds at once
 */
#define TXQ_SLOTS 8

/**
 * TXQ_TICK_MS - how often the queue worker runs
 *
 * sets how closely a packet's @delay_ms (relay jitter) is honored.
 */
#define TXQ_TICK_MS 25

/**
 * TXQ_ROTATE_MS - how long a packet stays on air before the next one's turn
 *
 * at the 100 ms advertising interval that's about 3 advertisements per turn.
 * TODO: tune with the scan window in the demo room.
 */
#define TXQ_ROTATE_MS 300

/**
 * TXQ_DEBUG - 1 = log every packet that goes on air, expires or is evicted
 *
 * set from CMake; noisy, for checking the queue on hardware.
 */
#ifndef TXQ_DEBUG
#define TXQ_DEBUG 0
#endif

/**
 * txq_slot_t - one queued packet
 * @pkt: the packet bytes
 * @len: bytes used in @pkt
 * @used: slot holds a packet
 * @send_after_ms: may go on air from this time, ms since boot
 * @expires_ms: dropped at this time, ms since boot
 */
typedef struct txq_slot {
	uint8_t pkt[MESH_ADV_BUDGET];
	uint8_t len;
	bool used;
	uint32_t send_after_ms;
	uint32_t expires_ms;
} txq_slot_t;

static txq_slot_t slots[TXQ_SLOTS];
static int on_air = -1; /* slot being advertised, -1 = advertising off */
static uint32_t on_air_since_ms;

/**
 * reached - whether time @t has come, safe across the ms counter wrapping
 * @now: current time, ms since boot
 * @t: the time to check
 *
 * return: true if @now is at or after @t.
 */
static bool reached(uint32_t now, uint32_t t) { return (int32_t)(now - t) >= 0; }

/**
 * slot_msg_id - a queued packet's msg_id, for debug logs
 * @slot: the slot
 *
 * return: the header's msg_id.
 */
static uint16_t slot_msg_id(const txq_slot_t *slot) {
	mesh_pkt_t hdr;

	memcpy(&hdr, slot->pkt, sizeof(hdr));
	return hdr.msg_id;
}

/**
 * drop_expired - free every slot whose packet has expired
 * @now: current time, ms since boot
 *
 * if the packet on air expires, on_air goes to -1 but advertising stays on
 * until txq_tick() puts something else up or turns it off.
 */
static void drop_expired(uint32_t now) {
	for (int i = 0; i < TXQ_SLOTS; i++) {
		if (!slots[i].used || !reached(now, slots[i].expires_ms))
			continue;

		if (TXQ_DEBUG)
			printf("[txq] expired slot %d msg_id=%u\n", i, slot_msg_id(&slots[i]));
		slots[i].used = false;
		if (i == on_air)
			on_air = -1;
	}
}

/**
 * next_ready - pick the next packet to advertise, round-robin
 * @now: current time, ms since boot
 *
 * starts looking just after the packet on air, so every ready packet gets a
 * turn. the packet on air is checked last, so it stays up if nothing else
 * is ready.
 *
 * return: the slot index, or -1 if no packet may go on air yet.
 */
static int next_ready(uint32_t now) {
	int start = on_air < 0 ? 0 : on_air + 1;

	for (int k = 0; k < TXQ_SLOTS; k++) {
		int i = (start + k) % TXQ_SLOTS;

		if (slots[i].used && reached(now, slots[i].send_after_ms))
			return i;
	}
	return -1;
}

/**
 * txq_step - expire packets and rotate the one on air
 *
 * a packet keeps the air for TXQ_ROTATE_MS, then the next ready one takes
 * over. with nothing ready, advertising is turned off.
 */
static void txq_step(void) {
	uint32_t now = to_ms_since_boot(get_absolute_time());

	drop_expired(now);

	if (on_air >= 0 && !reached(now, on_air_since_ms + TXQ_ROTATE_MS))
		return;

	int next = next_ready(now);

	if (next < 0) {
		if (ble_advertising()) {
			ble_advertise_stop();
			if (TXQ_DEBUG)
				printf("[txq] queue empty, advertising off\n");
		}
		on_air = -1;
		return;
	}

	if (next != on_air || !ble_advertising()) {
		ble_advertise(slots[next].pkt, slots[next].len);
		if (TXQ_DEBUG)
			printf("[txq] on air slot %d msg_id=%u\n", next, slot_msg_id(&slots[next]));
	}
	on_air = next;
	on_air_since_ms = now;
}

/**
 * txq_tick - at-time worker: run txq_step(), then come back in TXQ_TICK_MS
 * @context: the cyw43 async_context the worker runs on
 * @worker: this worker; re-added to repeat
 */
static void txq_tick(async_context_t *context, async_at_time_worker_t *worker) {
	txq_step();
	async_context_add_at_time_worker_in_ms(context, worker, TXQ_TICK_MS);
}

static async_at_time_worker_t txq_worker = {
	.do_work = txq_tick,
};

/**
 * txq_init - start the queue's worker on the cyw43 async_context
 *
 * return: 0 on success, -1 if the async_context rejected the worker.
 */
int txq_init(void) {
	return async_context_add_at_time_worker_in_ms(cyw43_arch_async_context(), &txq_worker,
												  TXQ_TICK_MS)
			   ? 0
			   : -1;
}

/**
 * pick_slot - find a slot for a new packet
 * @now: current time, ms since boot
 *
 * an empty slot if there is one, else the packet closest to expiring.
 *
 * return: the slot index.
 */
static int pick_slot(uint32_t now) {
	int victim = 0;

	for (int i = 0; i < TXQ_SLOTS; i++) {
		if (!slots[i].used)
			return i;
		if ((int32_t)(slots[i].expires_ms - now) < (int32_t)(slots[victim].expires_ms - now))
			victim = i;
	}

	if (TXQ_DEBUG)
		printf("[txq] full, evicting slot %d msg_id=%u\n", victim, slot_msg_id(&slots[victim]));
	if (victim == on_air)
		on_air = -1;
	return victim;
}

/**
 * txq_push - queue a packet for advertising
 * @pkt: a Serranet packet, starting at mesh_pkt_t.magic; copied
 * @len: bytes in @pkt, at most MESH_ADV_BUDGET
 * @delay_ms: wait this long before it may go on air
 * @lifetime_ms: drop it this long after the push
 *
 * return: 0 on success, -1 if @pkt is NULL, @len is 0 or too big, or
 * @lifetime_ms is not longer than @delay_ms.
 */
int txq_push(const void *pkt, uint8_t len, uint32_t delay_ms, uint32_t lifetime_ms) {
	if (pkt == NULL || len == 0 || len > MESH_ADV_BUDGET || lifetime_ms <= delay_ms)
		return -1;

	uint32_t now = to_ms_since_boot(get_absolute_time());
	txq_slot_t *slot = &slots[pick_slot(now)];

	memcpy(slot->pkt, pkt, len);
	slot->len = len;
	slot->send_after_ms = now + delay_ms;
	slot->expires_ms = now + lifetime_ms;
	slot->used = true;
	return 0;
}
