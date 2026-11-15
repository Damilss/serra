/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: mesh.h
 *
 * handled in core 0. mesh handles the flooding, the deduplication of the
 * payloads. TTL, and jitter
 *
 * node ID, sequence numbers, sending alerts, dedup on (src, msg_id), and
 * flooding: every new packet with hops left is relayed once, with ttl - 1,
 * after a random jitter. a test block list ignores chosen neighbors so
 * multi-hop can be forced on a desk.
 */
#ifndef MESH_MESH_H
#define MESH_MESH_H
#include <stdint.h>

#include "packet.h"

/**
 * mesh_init - pick this node's ID and msg_id seed, then start BLE
 *
 * call after cyw43_arch_init().
 *
 * return: 0 on success, -1 if BLE or the tx queue failed to start.
 */
int mesh_init(void);

/**
 * mesh_node_id - this node's ID, the @src of every packet it originates
 *
 * return: the ID, derived from the board's unique ID; never
 * MESH_DST_BROADCAST.
 */
uint16_t mesh_node_id(void);

/**
 * mesh_send_alert - originate an alert and queue it for advertising
 * @alert: the alert; copied
 *
 * stamps a new msg_id and MESH_TTL_DEFAULT. the alert takes turns on air
 * with other queued packets for a few seconds, then is dropped.
 *
 * return: 0 on success, -1 if @alert is NULL or the queue rejected it.
 */
int mesh_send_alert(const alert_payload_t *alert);

/**
 * mesh_block - ignore every packet transmitted by one radio (testing)
 * @tag: BLE_TAG() of the radio, as printed in "[ble] up ... (tag xxxx)"
 *
 * blocks by transmitter, not by origin: a relayed copy of the same node's
 * alert still gets through if a non-blocked neighbor sends it. that's
 * what forces A -> B -> C when all boards sit on one desk.
 *
 * return: 0 on success (or already blocked), -1 if the list is full.
 */
int mesh_block(uint16_t tag);

/**
 * mesh_unblock_all - clear the test block list
 */
void mesh_unblock_all(void);

/**
 * mesh_print_status - print node ID, counters and the block list
 */
void mesh_print_status(void);

#endif /* MESH_MESH_H */
