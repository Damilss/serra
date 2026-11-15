/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: console.c
 */
#include "console.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

#include "mesh.h"
#include "pico/async_context.h"
#include "pico/cyw43_arch.h"
#include "pico/stdlib.h"

/**
 * CONSOLE_POLL_MS - how often typed characters are read from USB serial
 */
#define CONSOLE_POLL_MS 20

/**
 * CONSOLE_LINE_MAX - longest command line, including the terminator
 */
#define CONSOLE_LINE_MAX 32

/**
 * TEST_BEACON_PERIOD_MS - how often the test beacon sends a fake alert
 *
 * 5 s = about one of our own alerts in the queue at a time, which leaves
 * room for relaying other nodes' alerts in the 8-slot queue.
 */
#define TEST_BEACON_PERIOD_MS 5000

static char line[CONSOLE_LINE_MAX];
static int line_len;
static bool beacon_on = true;

/**
 * send_test_alert - send one fake whistle alert
 * @why: label for the log line, "beacon" or "manual"
 */
static void send_test_alert(const char *why) {
	alert_payload_t alert = {
		.class_id = CLASS_WHISTLE,
		.confidence = 200,
		.peak_level = 853,
		.timestamp = to_ms_since_boot(get_absolute_time()),
		.blast_count = 3,
	};

	if (mesh_send_alert(&alert) == 0)
		printf("[test] %s alert queued, node 0x%04x ts=%lu\n", why, mesh_node_id(),
			   (unsigned long)alert.timestamp);
	else
		printf("[test] %s alert rejected by the queue\n", why);
}

/**
 * beacon_tick - at-time worker: send a test alert unless paused, repeat
 * @context: the cyw43 async_context the worker runs on
 * @worker: this worker; re-added every TEST_BEACON_PERIOD_MS
 */
static void beacon_tick(async_context_t *context, async_at_time_worker_t *worker) {
	if (beacon_on)
		send_test_alert("beacon");
	async_context_add_at_time_worker_in_ms(context, worker, TEST_BEACON_PERIOD_MS);
}

/**
 * print_help - list the console commands
 */
static void print_help(void) {
	printf("commands: a = send alert | b <tag> = block radio | u = unblock all |\n"
		   "          p = pause/resume beacon | s = status | h = help\n");
}

/**
 * run_command - parse and run one typed line
 * @cmd: the line, NUL-terminated, without the newline
 */
static void run_command(const char *cmd) {
	char *end;
	unsigned long tag;

	switch (cmd[0]) {
	case '\0':
		return;
	case 'a':
		send_test_alert("manual");
		return;
	case 'b':
		tag = strtoul(cmd + 1, &end, 16);
		if (end == cmd + 1 || tag > 0xFFFF) {
			printf("usage: b <tag>, e.g. b 4a9e (tag from the other board's [ble] up line)\n");
			return;
		}
		if (mesh_block((uint16_t)tag))
			printf("block list full\n");
		mesh_print_status();
		return;
	case 'u':
		mesh_unblock_all();
		mesh_print_status();
		return;
	case 'p':
		beacon_on = !beacon_on;
		printf("[test] beacon %s\n", beacon_on ? "on" : "paused");
		return;
	case 's':
		mesh_print_status();
		printf("[test] beacon %s\n", beacon_on ? "on" : "paused");
		return;
	default:
		print_help();
		return;
	}
}

/**
 * console_read - read typed characters, run full lines
 *
 * echoes what is typed, since PuTTY doesn't by default. Enter sends '\r'
 * in PuTTY and '\n' elsewhere; either ends the line. backspace works.
 */
static void console_read(void) {
	int c;

	while ((c = getchar_timeout_us(0)) != PICO_ERROR_TIMEOUT) {
		if (c == '\r' || c == '\n') {
			if (line_len == 0 && c == '\n')
				continue; /* second half of \r\n */
			putchar('\n');
			line[line_len] = '\0';
			run_command(line);
			line_len = 0;
		} else if ((c == '\b' || c == 0x7F) && line_len > 0) {
			line_len--;
			printf("\b \b");
		} else if (c >= ' ' && c < 0x7F && line_len < CONSOLE_LINE_MAX - 1) {
			line[line_len++] = (char)c;
			putchar(c);
		}
	}
}

/**
 * console_tick - at-time worker: read the console, repeat
 * @context: the cyw43 async_context the worker runs on
 * @worker: this worker; re-added every CONSOLE_POLL_MS
 */
static void console_tick(async_context_t *context, async_at_time_worker_t *worker) {
	console_read();
	async_context_add_at_time_worker_in_ms(context, worker, CONSOLE_POLL_MS);
}

static async_at_time_worker_t console_worker = {
	.do_work = console_tick,
};

static async_at_time_worker_t beacon_worker = {
	.do_work = beacon_tick,
};

/**
 * console_init - start the serial console and the test beacon as workers
 *
 * return: 0 on success, -1 if the async_context rejected a worker.
 */
int console_init(void) {
	async_context_t *context = cyw43_arch_async_context();

	if (!async_context_add_at_time_worker_in_ms(context, &console_worker, CONSOLE_POLL_MS) ||
		!async_context_add_at_time_worker_in_ms(context, &beacon_worker, TEST_BEACON_PERIOD_MS))
		return -1;
	print_help();
	return 0;
}
