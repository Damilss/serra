/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: mesh.h
 *
 * handled in core 0. mesh handles the flooding, the deduplication of the
 * payloads. TTL, and jitter
 *
 * for now: node ID, sequence numbers, sending alerts, dedup on
 * (src, msg_id), and logging what is heard. TTL relaying and jitter come
 * next.
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
 * return: 0 on success, -1 if BLE failed to start.
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
 * mesh_send_alert - originate an alert and start advertising it
 * @alert: the alert; copied
 *
 * stamps a new msg_id and MESH_TTL_DEFAULT. the alert stays on air until
 * the next mesh_send_alert() replaces it.
 *
 * return: 0 on success, -1 if @alert is NULL.
 */
int mesh_send_alert(const alert_payload_t *alert);

#endif /* MESH_MESH_H */
