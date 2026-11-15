/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: tx_queue.h
 *
 * runs on core 0. outgoing packet queue: BLE has one advertising slot, so
 * packets waiting to go out (our own alerts and relays) take turns in it.
 * each packet has a time it may start (relay jitter) and a time it expires.
 */
#ifndef MESH_TX_QUEUE_H
#define MESH_TX_QUEUE_H
#include <stdint.h>

/**
 * txq_init - start the queue's worker on the cyw43 async_context
 *
 * call after ble_init(). the worker ticks every TXQ_TICK_MS, drops expired
 * packets and rotates the advertised packet every TXQ_ROTATE_MS.
 *
 * return: 0 on success, -1 if the async_context rejected the worker.
 */
int txq_init(void);

/**
 * txq_push - queue a packet for advertising
 * @pkt: a Serranet packet, starting at mesh_pkt_t.magic; copied
 * @len: bytes in @pkt, at most MESH_ADV_BUDGET
 * @delay_ms: wait this long before it may go on air (relay jitter); 0 =
 *            next tick
 * @lifetime_ms: drop it this long after the push
 *
 * if the queue is full, the packet closest to expiring is replaced.
 *
 * return: 0 on success, -1 if @pkt is NULL, @len is 0 or too big, or
 * @lifetime_ms is not longer than @delay_ms.
 */
int txq_push(const void *pkt, uint8_t len, uint32_t delay_ms, uint32_t lifetime_ms);

#endif /* MESH_TX_QUEUE_H */
