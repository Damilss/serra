/**
 * author: Emilio Scott <milii76@outlook.com>
 *		   Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-13
 * file: btstack_config.h
 *
 * # bluetooth stack configuration is required by pico_btstack
 *
 * BTstack has no malloc and sizes everything at compile time, so every
 * project supplies this file. ours is BLE only: the mesh floods with
 * advertisements (advertise + scan) and never opens a connection, so
 * Classic Bluetooth is off and connection-related pools are kept minimal.
 * based on the Pico SDK's test/kitchen_sink/btstack_config.h.
 */
#ifndef _PICO_BTSTACK_BTSTACK_CONFIG_H
#define _PICO_BTSTACK_BTSTACK_CONFIG_H

/**
 * features - which parts of BTstack are compiled in
 *
 * ENABLE_LE_PERIPHERAL: send advertisements (our alerts and relays)
 * ENABLE_LE_CENTRAL: scan for other nodes' advertisements
 * ENABLE_LOG_ERROR: print BTstack errors over stdio
 */
#define ENABLE_LE_PERIPHERAL
#define ENABLE_LE_CENTRAL
#define ENABLE_LOG_ERROR
#define ENABLE_PRINTF_HEXDUMP

/**
 * buffers and pools - memory BTstack reserves at compile time
 *
 * connection, GATT and security pools are set to their minimum: the mesh
 * only advertises and scans. raise them if we ever add a GATT service.
 */
#define HCI_OUTGOING_PRE_BUFFER_SIZE 4
#define HCI_ACL_PAYLOAD_SIZE (255 + 4)
#define HCI_ACL_CHUNK_SIZE_ALIGNMENT 4
#define MAX_NR_GATT_CLIENTS 1
#define MAX_NR_HCI_CONNECTIONS 1
#define MAX_NR_L2CAP_CHANNELS 1
#define MAX_NR_L2CAP_SERVICES 1
#define MAX_NR_SM_LOOKUP_ENTRIES 3
#define MAX_NR_WHITELIST_ENTRIES 1
#define MAX_NR_LE_DEVICE_DB_ENTRIES 1

/**
 * CYW43 shared bus - limit buffers and enable flow control
 *
 * the radio chip shares one bus between Wi-Fi and Bluetooth; the SDK's
 * reference config caps these so the bus isn't overrun.
 */
#define MAX_NR_CONTROLLER_ACL_BUFFERS 3
#define MAX_NR_CONTROLLER_SCO_PACKETS 3
#define ENABLE_HCI_CONTROLLER_TO_HOST_FLOW_CONTROL
#define HCI_HOST_ACL_PACKET_LEN (255 + 4)
#define HCI_HOST_ACL_PACKET_NUM 3
#define HCI_HOST_SCO_PACKET_LEN 120
#define HCI_HOST_SCO_PACKET_NUM 3

/**
 * flash storage - key and device database
 *
 * unused by the mesh (no pairing), but the SDK's BTstack port expects it.
 */
#define NVM_NUM_DEVICE_DB_ENTRIES 16
#define NVM_NUM_LINK_KEYS 16

/**
 * MAX_ATT_DB_SIZE - fixed-size GATT attribute database, since there's no malloc
 */
#define MAX_ATT_DB_SIZE 512

/**
 * platform - how BTstack talks to the Pico SDK
 *
 * HAVE_EMBEDDED_TIME_MS: BTstack gets time from the SDK
 * HAVE_ASSERT: btstack_assert() maps onto the SDK's assert()
 */
#define HAVE_EMBEDDED_TIME_MS
#define HAVE_ASSERT
#define HCI_RESET_RESEND_TIMEOUT_MS 1000
#define ENABLE_SOFTWARE_AES128
#define ENABLE_MICRO_ECC_FOR_LE_SECURE_CONNECTIONS

#endif /* _PICO_BTSTACK_BTSTACK_CONFIG_H */
