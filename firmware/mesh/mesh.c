/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: mesh.c
 *
 * handled in core 0. mesh handles the flooding, the deduplication of the
 * payloads. TTL, and jitter
 */
#include "mesh.h"

#include <stdio.h>
#include <string.h>

#include "ble.h"
#include "pico/rand.h"
#include "pico/unique_id.h"

static uint16_t node_id;
static uint16_t next_msg_id;

/**
 * node_id_from_board - fold the board's unique ID into 16 bits
 *
 * XORs the ID's 16-bit halves together, so the same board always gets the
 * same ID with no configuration. two boards could collide; with a handful
 * of nodes that's unlikely, and the boot log prints the ID to check.
 *
 * return: the ID; never MESH_DST_BROADCAST.
 */
static uint16_t node_id_from_board(void) {
	pico_unique_board_id_t board;
	uint16_t id = 0;

	pico_get_unique_board_id(&board);
	for (int i = 0; i + 1 < PICO_UNIQUE_BOARD_ID_SIZE_BYTES; i += 2)
		id ^= (uint16_t)(board.id[i] | (board.id[i + 1] << 8));

	if (id == MESH_DST_BROADCAST)
		id = 0xFFFE;
	return id;
}

/**
 * on_ble_rx - log a Serranet packet heard over BLE
 * @pkt: the packet, starting at the header
 * @len: bytes in @pkt, at least sizeof(mesh_pkt_t)
 * @rssi: signal strength in dBm
 *
 * TODO: dedup on (src, msg_id), then relay with ttl - 1 after a jitter.
 */
static void on_ble_rx(const uint8_t *pkt, uint8_t len, int8_t rssi) {
	mesh_pkt_t hdr;

	memcpy(&hdr, pkt, sizeof(hdr));
	if (hdr.src == node_id)
		return;

	printf("[mesh] rx src=0x%04x msg_id=%u ttl=%u type=%u rssi=%d", hdr.src, hdr.msg_id, hdr.ttl,
		   hdr.type, rssi);

	if (hdr.type == MESH_TYPE_ALERT && len >= sizeof(mesh_pkt_t) + sizeof(alert_payload_t)) {
		alert_payload_t alert;

		memcpy(&alert, pkt + sizeof(mesh_pkt_t), sizeof(alert));
		printf(" class=%u conf=%u peak=%d ts=%lu", alert.class_id, alert.confidence,
			   alert.peak_level, (unsigned long)alert.timestamp);
	}
	printf("\n");
}

/**
 * mesh_init - pick this node's ID and msg_id seed, then start BLE
 *
 * msg_id is seeded randomly so a rebooted node doesn't reuse IDs its
 * neighbors still have cached (README "Node IDs and sequence numbers").
 *
 * return: 0 on success, -1 if BLE failed to start.
 */
int mesh_init(void) {
	node_id = node_id_from_board();
	next_msg_id = (uint16_t)get_rand_32();
	printf("[mesh] node 0x%04x\n", node_id);

	return ble_init(on_ble_rx);
}

/**
 * mesh_node_id - this node's ID, the @src of every packet it originates
 *
 * return: the ID set by mesh_init().
 */
uint16_t mesh_node_id(void) { return node_id; }

/**
 * mesh_send_alert - originate an alert and start advertising it
 * @alert: the alert; copied
 *
 * return: 0 on success, -1 if @alert is NULL.
 */
int mesh_send_alert(const alert_payload_t *alert) {
	uint8_t buf[sizeof(mesh_pkt_t) + sizeof(alert_payload_t)];
	mesh_pkt_t hdr = {
		.magic = MESH_MAGIC,
		.src = node_id,
		.dst = MESH_DST_BROADCAST,
		.msg_id = next_msg_id++,
		.ttl = MESH_TTL_DEFAULT,
		.type = MESH_TYPE_ALERT,
	};

	if (alert == NULL)
		return -1;

	memcpy(buf, &hdr, sizeof(hdr));
	memcpy(buf + sizeof(hdr), alert, sizeof(*alert));
	return ble_advertise(buf, sizeof(buf));
}
