/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: console.h
 *
 * runs on core 0. TEMPORARY test tools for the mesh: a serial command line
 * (type into PuTTY) and a test beacon that sends fake alerts until real
 * ones come from the classifier.
 *
 * commands (Enter to run):
 *   a          send one test alert now
 *   b <tag>    block a neighbor radio, e.g. "b 4a9e" (tag from its boot log)
 *   u          unblock all
 *   p          pause / resume the test beacon
 *   s          status: node ID, counters, block list
 *   h          help
 */
#ifndef MESH_CONSOLE_H
#define MESH_CONSOLE_H

/**
 * console_init - start the serial console and the test beacon
 *
 * call after mesh_init().
 *
 * return: 0 on success, -1 if the async_context rejected a worker.
 */
int console_init(void);

#endif /* MESH_CONSOLE_H */
