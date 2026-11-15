/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: ble.h
 *
 * ble will run on core 0. BTstack advertise and scan wrapper functions
 * will go here.
 *
 * thin layer over BTstack: puts a Serranet packet in a non-connectable
 * advertisement and hands Serranet packets heard while scanning to a
 * callback. knows the advertisement framing (flags, manufacturer data,
 * MESH_COMPANY_ID, MESH_MAGIC) but nothing about flooding; that's mesh.c.
 */
#ifndef MESH_BLE_H
#define MESH_BLE_H
#include <stdbool.h>
#include <stdint.h>

/**
 * BLE_TAG - 16-bit tag for a radio: the last two bytes of its BLE address
 * @addr: a BTstack bd_addr_t, in the order bd_addr_to_str() prints it
 *
 * "2C:CF:67:12:4A:9E" -> 0x4A9E. used to name the neighbor that transmitted
 * a packet, which for a relayed packet is not its origin (@src).
 */
#define BLE_TAG(addr) ((uint16_t)(((addr)[4] << 8) | (addr)[5]))

/**
 * ble_rx_cb_t - called for every Serranet packet heard while scanning
 * @pkt: the packet, starting at mesh_pkt_t.magic; only valid during the call
 * @len: bytes in @pkt, at least sizeof(mesh_pkt_t)
 * @rssi: received signal strength in dBm
 * @from: BLE_TAG() of the radio that transmitted this copy
 *
 * runs on core 0 from the main loop's cyw43_arch_poll(). fires on
 * every advertisement, so the same packet arrives many times; dedup is the
 * mesh layer's job.
 */
typedef void (*ble_rx_cb_t)(const uint8_t *pkt, uint8_t len, int8_t rssi, uint16_t from);

/**
 * ble_init - start BTstack, then scan for Serranet packets
 * @on_rx: called for each Serranet packet heard
 *
 * call after cyw43_arch_init(). BTstack only runs when the main loop polls
 * the cyw43 async_context, so scanning starts once the stack is up
 * (HCI_STATE_WORKING), a moment after the main loop starts.
 *
 * return: 0 on success, -1 if @on_rx is NULL or BTstack failed to power on.
 */
int ble_init(ble_rx_cb_t on_rx);

/**
 * ble_advertise - advertise @pkt until the next call replaces it
 * @pkt: a Serranet packet, starting at mesh_pkt_t.magic; copied
 * @len: bytes in @pkt, at most MESH_ADV_BUDGET
 *
 * the first call turns advertising on. safe to call before the stack is
 * up; BTstack applies it once it is.
 *
 * return: 0 on success, -1 if @pkt is NULL or @len is too big.
 */
int ble_advertise(const void *pkt, uint8_t len);

/**
 * ble_advertise_stop - turn advertising off
 *
 * the next ble_advertise() turns it back on. scanning is not affected.
 */
void ble_advertise_stop(void);

/**
 * ble_advertising - whether advertising is on
 *
 * return: true between ble_advertise() and ble_advertise_stop().
 */
bool ble_advertising(void);

#endif /* MESH_BLE_H */
