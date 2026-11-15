/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: console.h
 *
 * runs on core 0. test tools for the mesh: a serial command line (type
 * into PuTTY or screen). nothing is sent unless someone types a command;
 * real alerts come from the classifier on core 1.
 *
 * commands (Enter to run):
 *   a          send one test alert now (a fake whistle; the base station
 *              and dashboard show it like a real one)
 *   b <tag>    block a neighbor radio, e.g. "b 4a9e" (tag from its boot log)
 *   u          unblock all
 *   s          status: node ID, counters, block list
 *   h          help
 */
#ifndef MESH_CONSOLE_H
#define MESH_CONSOLE_H

/**
 * console_init - start the serial console
 *
 * call after mesh_init().
 *
 * return: 0 on success, -1 if the async_context rejected a worker.
 */
int console_init(void);

#endif /* MESH_CONSOLE_H */
