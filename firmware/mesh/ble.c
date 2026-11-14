/**
 * Authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: ble.c
 */
#include "ble.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "btstack.h"
#include "packet.h"

/**
 * BLE_ADV_INTERVAL - time between advertisements, in 0.625 ms units
 *
 * 0x00A0 = 100 ms. TODO: tune against power once the mesh works.
 */
#define BLE_ADV_INTERVAL 0x00A0

/**
 * BLE_SCAN_INTERVAL - how often a scan window starts, in 0.625 ms units
 * BLE_SCAN_WINDOW - how long each window listens, in 0.625 ms units
 *
 * 100 ms / 50 ms = listening half the time, leaving the controller room to
 * send our own advertisements. TODO: tune for power (README "Scan duty
 * cycle vs. power").
 */
#define BLE_SCAN_INTERVAL 0x00A0
#define BLE_SCAN_WINDOW 0x0050

/**
 * BLE_ADV_NONCONN_IND - advertising type: non-connectable, non-scannable
 */
#define BLE_ADV_NONCONN_IND 0x03

/**
 * BLE_ADV_CHANNELS_ALL - advertise on channels 37, 38 and 39
 */
#define BLE_ADV_CHANNELS_ALL 0x07

/**
 * BLE_SCAN_PASSIVE - scan type: listen only, never send scan requests
 */
#define BLE_SCAN_PASSIVE 0

/**
 * BLE_FLAGS_BREDR_NOT_SUPPORTED - flags AD value: LE only
 */
#define BLE_FLAGS_BREDR_NOT_SUPPORTED 0x04

/**
 * BLE_ADV_MAX - bytes in a legacy advertisement
 */
#define BLE_ADV_MAX 31

/*
 * BTstack keeps a pointer to the advertising data, not a copy, so it lives
 * here for good.
 */
static uint8_t adv_data[BLE_ADV_MAX];
static bool adv_enabled;
static ble_rx_cb_t rx_cb;
static btstack_packet_callback_registration_t hci_cb_reg;

/**
 * handle_adv_report - pass a Serranet packet in an advertisement to rx_cb
 * @packet: a GAP_EVENT_ADVERTISING_REPORT event
 *
 * walks the advertisement's AD structures for manufacturer data that starts
 * with MESH_COMPANY_ID and MESH_MAGIC; everything else (phones, earbuds,
 * other prototypes) is dropped here.
 */
static void handle_adv_report(const uint8_t *packet) {
	uint8_t len = gap_event_advertising_report_get_data_length(packet);
	const uint8_t *data = gap_event_advertising_report_get_data(packet);
	int8_t rssi = (int8_t)gap_event_advertising_report_get_rssi(packet);
	ad_context_t it;

	for (ad_iterator_init(&it, len, data); ad_iterator_has_more(&it); ad_iterator_next(&it)) {
		if (ad_iterator_get_data_type(&it) != BLUETOOTH_DATA_TYPE_MANUFACTURER_SPECIFIC_DATA)
			continue;

		uint8_t mfg_len = ad_iterator_get_data_len(&it);
		const uint8_t *mfg = ad_iterator_get_data(&it);

		/* 2 bytes of company ID, then the Serranet packet */
		if (mfg_len < 2 + sizeof(mesh_pkt_t))
			continue;
		if (little_endian_read_16(mfg, 0) != MESH_COMPANY_ID || mfg[2] != MESH_MAGIC)
			continue;

		rx_cb(mfg + 2, mfg_len - 2, rssi);
		return;
	}
}

/**
 * hci_event_handler - BTstack HCI event callback
 * @packet_type: only HCI_EVENT_PACKET is handled
 * @channel: unused
 * @packet: the event
 * @size: unused
 *
 * starts scanning once the stack is up, and feeds advertising reports to
 * handle_adv_report().
 */
static void hci_event_handler(uint8_t packet_type, uint16_t channel, uint8_t *packet,
							  uint16_t size) {
	(void)channel;
	(void)size;

	if (packet_type != HCI_EVENT_PACKET)
		return;

	switch (hci_event_packet_get_type(packet)) {
	case BTSTACK_EVENT_STATE: {
		if (btstack_event_state_get_state(packet) != HCI_STATE_WORKING)
			break;

		bd_addr_t addr;
		gap_local_bd_addr(addr);
		printf("[ble] up, addr %s, scanning\n", bd_addr_to_str(addr));

		gap_set_scan_params(BLE_SCAN_PASSIVE, BLE_SCAN_INTERVAL, BLE_SCAN_WINDOW, 0);
		gap_start_scan();
		break;
	}
	case GAP_EVENT_ADVERTISING_REPORT:
		handle_adv_report(packet);
		break;
	default:
		break;
	}
}

/**
 * ble_init - start BTstack, then scan for Serranet packets
 * @on_rx: called for each Serranet packet heard
 *
 * return: 0 on success, -1 if @on_rx is NULL or BTstack failed to power on.
 */
int ble_init(ble_rx_cb_t on_rx) {
	if (on_rx == NULL)
		return -1;
	rx_cb = on_rx;

	l2cap_init();

	hci_cb_reg.callback = hci_event_handler;
	hci_add_event_handler(&hci_cb_reg);

	bd_addr_t no_direct_addr = {0};
	gap_advertisements_set_params(BLE_ADV_INTERVAL, BLE_ADV_INTERVAL, BLE_ADV_NONCONN_IND, 0,
								  no_direct_addr, BLE_ADV_CHANNELS_ALL, 0);

	if (hci_power_control(HCI_POWER_ON) != 0) {
		printf("[ble] hci_power_control failed\n");
		return -1;
	}
	return 0;
}

/**
 * ble_advertise - advertise @pkt until the next call replaces it
 * @pkt: a Serranet packet, starting at mesh_pkt_t.magic; copied
 * @len: bytes in @pkt, at most MESH_ADV_BUDGET
 *
 * layout: [2, FLAGS, 0x04] [3 + @len, MANUFACTURER_DATA, 0xFF, 0xFF, @pkt...]
 *
 * return: 0 on success, -1 if @pkt is NULL or @len is too big.
 */
int ble_advertise(const void *pkt, uint8_t len) {
	if (pkt == NULL || len > MESH_ADV_BUDGET)
		return -1;

	uint8_t *p = adv_data;

	*p++ = 2;
	*p++ = BLUETOOTH_DATA_TYPE_FLAGS;
	*p++ = BLE_FLAGS_BREDR_NOT_SUPPORTED;

	*p++ = 3 + len; /* type byte + company ID + packet */
	*p++ = BLUETOOTH_DATA_TYPE_MANUFACTURER_SPECIFIC_DATA;
	little_endian_store_16(p, 0, MESH_COMPANY_ID);
	p += 2;
	memcpy(p, pkt, len);
	p += len;

	gap_advertisements_set_data((uint8_t)(p - adv_data), adv_data);

	if (!adv_enabled) {
		gap_advertisements_enable(1);
		adv_enabled = true;
	}
	return 0;
}

/**
 * ble_advertise_stop - turn advertising off
 */
void ble_advertise_stop(void) {
	if (!adv_enabled)
		return;
	gap_advertisements_enable(0);
	adv_enabled = false;
}

/**
 * ble_advertising - whether advertising is on
 *
 * return: true between ble_advertise() and ble_advertise_stop().
 */
bool ble_advertising(void) { return adv_enabled; }
