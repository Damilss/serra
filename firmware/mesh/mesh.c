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

#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "ble.h"
#include "pico/rand.h"
#include "pico/time.h"
#include "pico/unique_id.h"
#include "tx_queue.h"

/**
 * MESH_ALERT_LIFETIME_MS - how long an alert we originate stays queued
 *
 * long enough for neighbors to catch it through a 50% scan window while it
 * shares the air with other queued packets. TODO: tune in the demo room.
 */
#define MESH_ALERT_LIFETIME_MS 5000

/**
 * MESH_RELAY_LIFETIME_MS - how long a relayed packet stays queued
 *
 * same as our own alerts for now. TODO: tune in the demo room; shorter
 * means less air traffic, longer means fewer misses.
 */
#define MESH_RELAY_LIFETIME_MS 5000

/**
 * MESH_RELAY_JITTER_MIN_MS - shortest random wait before relaying
 * MESH_RELAY_JITTER_MAX_MS - longest random wait before relaying
 *
 * neighbors that hear the same packet at the same moment would otherwise
 * relay it at the same moment and collide.
 */
#define MESH_RELAY_JITTER_MIN_MS 10
#define MESH_RELAY_JITTER_MAX_MS 50

/**
 * MESH_BLOCK_SLOTS - how many radios the test block list holds
 */
#define MESH_BLOCK_SLOTS 8

/**
 * MESH_SEEN_SLOTS - how many (src, msg_id) pairs the dedup cache holds
 *
 * an entry has to outlive the packet's time on air, or late copies get
 * handled twice. at 8 bytes per entry 64 slots is 512 bytes, enough for a
 * few nodes each sending about one packet a second.
 */
#define MESH_SEEN_SLOTS 64

/**
 * MESH_SEEN_EXPIRY_MS - how long a (src, msg_id) pair counts as seen
 *
 * 60 s, per README "Node IDs and sequence numbers": a second guard, after
 * the random msg_id seed, against a rebooted node's alerts being dropped.
 */
#define MESH_SEEN_EXPIRY_MS 60000

/**
 * mesh_seen_t - one dedup cache entry
 * @src: origin node ID of the packet
 * @msg_id: the origin's sequence number
 * @used: slot holds an entry
 * @seen_at_ms: when the first copy arrived, ms since boot
 */
typedef struct mesh_seen {
	uint16_t src;
	uint16_t msg_id;
	bool used;
	uint32_t seen_at_ms;
} mesh_seen_t;

static uint16_t node_id;
static uint16_t next_msg_id;
static mesh_seen_t seen[MESH_SEEN_SLOTS];
static uint32_t dups_dropped;
static uint32_t relays_sent;
static uint16_t blocked[MESH_BLOCK_SLOTS];
static int num_blocked;

/**
 * seen_age_ms - how long ago a cache entry was recorded
 * @entry: the entry
 * @now_ms: current time, ms since boot
 *
 * unsigned subtraction keeps this right when the ms counter wraps.
 *
 * return: age in ms.
 */
static uint32_t seen_age_ms(const mesh_seen_t *entry, uint32_t now_ms) {
	return (uint32_t)(now_ms - entry->seen_at_ms);
}

/**
 * seen_check_and_add - look up (src, msg_id); record it if it's new
 * @src: origin node ID
 * @msg_id: origin sequence number
 *
 * one pass over the cache: clears entries older than MESH_SEEN_EXPIRY_MS,
 * looks for the pair, and picks where a new pair would go (an empty slot
 * if there is one, else the oldest entry). 64 slots is small enough that a
 * linear scan is fine.
 *
 * return: true if the pair was already seen (drop the packet), false if
 * it's new (handle it).
 */
static bool seen_check_and_add(uint16_t src, uint16_t msg_id) {
	uint32_t now_ms = to_ms_since_boot(get_absolute_time());
	mesh_seen_t *victim = NULL;

	for (int i = 0; i < MESH_SEEN_SLOTS; i++) {
		mesh_seen_t *entry = &seen[i];

		if (entry->used && seen_age_ms(entry, now_ms) >= MESH_SEEN_EXPIRY_MS)
			entry->used = false;

		if (!entry->used) {
			if (victim == NULL || victim->used)
				victim = entry;
			continue;
		}

		if (entry->src == src && entry->msg_id == msg_id)
			return true;

		if (victim == NULL ||
			(victim->used && seen_age_ms(entry, now_ms) > seen_age_ms(victim, now_ms)))
			victim = entry;
	}

	*victim = (mesh_seen_t){
		.src = src,
		.msg_id = msg_id,
		.used = true,
		.seen_at_ms = now_ms,
	};
	return false;
}

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
 * is_blocked - whether packets transmitted by this radio are ignored
 * @from: BLE_TAG() of the transmitting radio
 *
 * return: true if @from is on the test block list.
 */
static bool is_blocked(uint16_t from) {
	for (int i = 0; i < num_blocked; i++) {
		if (blocked[i] == from)
			return true;
	}
	return false;
}

/**
 * relay - queue a copy of @pkt with one less hop, after a random jitter
 * @pkt: the packet as heard
 * @len: bytes in @pkt
 *
 * src and msg_id stay the same, so every node keeps recognizing the copies
 * as one message. only call for a packet seen for the first time with
 * ttl > 0.
 */
static void relay(const uint8_t *pkt, uint8_t len) {
	uint8_t buf[MESH_ADV_BUDGET];
	uint32_t jitter = MESH_RELAY_JITTER_MIN_MS +
					  get_rand_32() % (MESH_RELAY_JITTER_MAX_MS - MESH_RELAY_JITTER_MIN_MS + 1);

	if (len > sizeof(buf))
		return;

	memcpy(buf, pkt, len);
	buf[offsetof(mesh_pkt_t, ttl)]--;

	if (txq_push(buf, len, jitter, jitter + MESH_RELAY_LIFETIME_MS) == 0) {
		relays_sent++;
		printf("[mesh] relay ttl=%u in %lu ms (relays=%lu)\n", buf[offsetof(mesh_pkt_t, ttl)],
			   (unsigned long)jitter, (unsigned long)relays_sent);
	}
}

/**
 * on_ble_rx - handle a Serranet packet heard over BLE
 * @pkt: the packet, starting at the header
 * @len: bytes in @pkt, at least sizeof(mesh_pkt_t)
 * @rssi: signal strength in dBm
 * @from: BLE_TAG() of the radio that transmitted this copy
 *
 * drops copies from blocked radios (desk testing), our own packets (heard
 * back after a neighbor relays them) and any (src, msg_id) already seen, so
 * each message is handled once no matter how many copies or paths it
 * arrives by. a new message is logged and, if it has hops left
 * (ttl > 0), relayed.
 */
static void on_ble_rx(const uint8_t *pkt, uint8_t len, int8_t rssi, uint16_t from) {
	mesh_pkt_t hdr;

	if (is_blocked(from))
		return;

	memcpy(&hdr, pkt, sizeof(hdr));
	if (hdr.src == node_id)
		return;

	if (seen_check_and_add(hdr.src, hdr.msg_id)) {
		dups_dropped++;
		return;
	}

	printf("[mesh] rx src=0x%04x msg_id=%u ttl=%u via=%04x rssi=%d dups=%lu", hdr.src, hdr.msg_id,
		   hdr.ttl, from, rssi, (unsigned long)dups_dropped);

	if (hdr.type == MESH_TYPE_ALERT && len >= sizeof(mesh_pkt_t) + sizeof(alert_payload_t)) {
		alert_payload_t alert;

		memcpy(&alert, pkt + sizeof(mesh_pkt_t), sizeof(alert));
		printf(" class=%u conf=%u peak=%d ts=%lu", alert.class_id, alert.confidence,
			   alert.peak_level, (unsigned long)alert.timestamp);
	}
	printf("\n");

	if (hdr.ttl > 0)
		relay(pkt, len);
}

/**
 * mesh_init - pick this node's ID and msg_id seed, then start BLE
 *
 * msg_id is seeded randomly so a rebooted node doesn't reuse IDs its
 * neighbors still have cached (README "Node IDs and sequence numbers").
 *
 * return: 0 on success, -1 if BLE or the tx queue failed to start.
 */
int mesh_init(void) {
	node_id = node_id_from_board();
	next_msg_id = (uint16_t)get_rand_32();
	printf("[mesh] node 0x%04x\n", node_id);

	if (ble_init(on_ble_rx))
		return -1;
	return txq_init();
}

/**
 * mesh_node_id - this node's ID, the @src of every packet it originates
 *
 * return: the ID set by mesh_init().
 */
uint16_t mesh_node_id(void) { return node_id; }

/**
 * mesh_send_alert - originate an alert and queue it for advertising
 * @alert: the alert; copied
 *
 * it goes on air within one queue tick and stays queued for
 * MESH_ALERT_LIFETIME_MS, taking turns with other queued packets.
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
	return txq_push(buf, sizeof(buf), 0, MESH_ALERT_LIFETIME_MS);
}

/**
 * mesh_block - ignore every packet transmitted by one radio
 * @tag: BLE_TAG() of the radio, as printed in "[ble] up ... (tag xxxx)"
 *
 * return: 0 on success (or already blocked), -1 if the list is full.
 */
int mesh_block(uint16_t tag) {
	if (is_blocked(tag))
		return 0;
	if (num_blocked >= MESH_BLOCK_SLOTS)
		return -1;
	blocked[num_blocked++] = tag;
	return 0;
}

/**
 * mesh_unblock_all - clear the test block list
 */
void mesh_unblock_all(void) { num_blocked = 0; }

/**
 * mesh_print_status - print node ID, counters and the block list
 */
void mesh_print_status(void) {
	printf("[mesh] node 0x%04x dups=%lu relays=%lu blocked:", node_id, (unsigned long)dups_dropped,
		   (unsigned long)relays_sent);
	if (num_blocked == 0)
		printf(" none");
	for (int i = 0; i < num_blocked; i++)
		printf(" %04x", blocked[i]);
	printf("\n");
}
