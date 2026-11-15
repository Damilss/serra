/**
 * author: Emilio Scott <milii76@outlook.com>,
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: packet.h
 *
 * includes the meshing packet, and payload packets
 *
 * Serranet wire format: the exact bytes every node and the base station
 * agree on. this is a team contract (CONTRIBUTING.md, "The packet format is
 * a contract"): a change here also needs the base-station decoder and the
 * README's Mesh protocol section updated in the same PR.
 *
 * multi-byte fields go over the air little-endian, the RP2350's native
 * order. the base station decodes with Python struct formats:
 *   header: '<BHHHBB'   alert: '<BBhIB'
 */
#ifndef MESH_PACKET_H
#define MESH_PACKET_H
#include <assert.h>
#include <stdint.h>

/**
 * MESH_MAGIC - first byte of every Serranet packet
 *
 * lets a node ignore every other BLE device's advertisements. pinned: the
 * base station's protocol.py has the same value, and its tests read this
 * file and fail if the two differ.
 */
#define MESH_MAGIC 0x5E

/**
 * MESH_COMPANY_ID - company ID in the advertisement's manufacturer-data field
 *
 * 0xFFFF is the Bluetooth SIG's ID reserved for testing and prototypes.
 * checking it first drops nearly every other device's advertisements
 * (phones, earbuds, watches use their own IDs); MESH_MAGIC then separates us
 * from other prototypes that also use 0xFFFF.
 */
#define MESH_COMPANY_ID 0xFFFF

/**
 * MESH_DST_BROADCAST - @dst value meaning "every node"
 */
#define MESH_DST_BROADCAST 0xFFFF

/**
 * MESH_TTL_DEFAULT - hops a new packet may travel before relays drop it
 *
 * the base station mirrors this as TTL_INITIAL (hops = TTL_INITIAL - ttl),
 * and its tests fail if the two differ: change both together.
 * TODO: tune for the demo layout (3-5 covers 3-4 nodes).
 */
#define MESH_TTL_DEFAULT 4

/**
 * MESH_ADV_BUDGET - bytes left for a packet inside one BLE advertisement
 *
 * a legacy advertisement is 31 bytes: minus 3 for the flags field and 4 for
 * the manufacturer-data header (length, type, company ID 0xFFFF) leaves 24.
 */
#define MESH_ADV_BUDGET 24

/**
 * mesh_type_t - what follows the header, stored in mesh_pkt_t.type
 * @MESH_TYPE_ALERT: an alert_payload_t
 * @MESH_TYPE_HEARTBEAT: "I'm alive" (stretch goal; payload not defined yet)
 */
typedef enum mesh_type {
	MESH_TYPE_ALERT = 1,
	MESH_TYPE_HEARTBEAT = 2,
} mesh_type_t;

/**
 * alert_class_t - what the classifier heard, stored in alert_payload_t.class_id
 * @CLASS_WHISTLE: a whistle (see alert_payload_t.blast_count)
 * @CLASS_SCREAM: a scream
 * @CLASS_HELP: the spoken word "help"
 *
 * other_speech and background never produce alerts, so they have no value.
 */
typedef enum alert_class {
	CLASS_WHISTLE = 1,
	CLASS_SCREAM = 2,
	CLASS_HELP = 3,
} alert_class_t;

/**
 * mesh_pkt_t - header at the start of every Serranet packet (9 bytes)
 * @magic: MESH_MAGIC
 * @src: origin node ID; relays never change it
 * @dst: MESH_DST_BROADCAST
 * @msg_id: per-origin sequence number, randomly seeded at boot;
 *          (@src, @msg_id) identifies a message for dedup
 * @ttl: hops remaining; relays decrement it and stop at 0
 * @type: mesh_type_t, says what @payload holds
 * @payload: type-specific bytes, e.g. an alert_payload_t
 */
typedef struct __attribute__((packed)) mesh_pkt {
	uint8_t magic;
	uint16_t src;
	uint16_t dst;
	uint16_t msg_id;
	uint8_t ttl;
	uint8_t type;
	uint8_t payload[];
} mesh_pkt_t;

/**
 * alert_payload_t - payload of a MESH_TYPE_ALERT packet (9 bytes)
 * @class_id: alert_class_t
 * @confidence: classifier confidence, 0-255
 * @peak_level: calibrated peak loudness in tenths of a dB (853 = 85.3 dB)
 * @timestamp: origin node uptime in ms; not synced across nodes
 * @blast_count: whistles only, 3 = distress pattern; 0 for SCREAM and HELP
 */
typedef struct __attribute__((packed)) alert_payload {
	uint8_t class_id;
	uint8_t confidence;
	int16_t peak_level;
	uint32_t timestamp;
	uint8_t blast_count;
} alert_payload_t;

/* the layout is the contract: fail the build if it changes by accident */
static_assert(sizeof(mesh_pkt_t) == 9, "mesh header is 9 bytes");
static_assert(sizeof(alert_payload_t) == 9, "alert payload is 9 bytes");
static_assert(sizeof(mesh_pkt_t) + sizeof(alert_payload_t) <= MESH_ADV_BUDGET,
			  "an alert must fit in one BLE advertisement");
static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__,
			  "packets are sent in native order, which must be little-endian");

#endif /* MESH_PACKET_H */
