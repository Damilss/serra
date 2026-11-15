/**
 * authors: Emilio Scott <milii76@outlook.com>,
 *			Elias Santillan <emsantil@calpoly.edu>
 * date: 2026-11-14
 * file: listen.h
 *
 * core 1: the node's ears. reads the INMP441 (mic.c), feeds the classifier
 * (classifier.h) and hands every detection to core 0 through runtime/ipc,
 * which sends it over the mesh. core 0 keeps the radio; core 1 never
 * touches it.
 */
#ifndef AUDIO_LISTEN_H
#define AUDIO_LISTEN_H

/**
 * listen_start - launch the mic + classifier loop on core 1
 *
 * call on core 0 after ipc_init(). returns at once; core 1 then loads the
 * model, starts the mic, skips its startup silence and listens forever.
 * failures are printed on USB serial ("[listen] ...") rather than returned,
 * since they happen on core 1 after this has returned.
 */
void listen_start(void);

#endif /* AUDIO_LISTEN_H */
