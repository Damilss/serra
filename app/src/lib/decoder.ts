// Live link to the base-station decoder (serra-base on the Pi 5, branch base-station).
//
// serra-base serves every decoded, deduplicated Serranet packet as Server-Sent Events on
// GET /events and its status on GET /health, port 8080, with CORS open, so the browser connects to
// it directly. Contract: base-station/README.md, "Output: event stream".
//
// Over the USB cable the Pi is always 10.12.194.1. With no Pi, run `npm run mock:decoder` (or
// serra-base --source sim / ble on the laptop) and use localhost.

import type { AlertClass } from './types';

export const PI_URL = 'http://10.12.194.1:8080';
export const LOCAL_URL = 'http://localhost:8080';

/** One `packet` event from /events. */
export interface DecoderEvent {
  run_id: string;
  seq: number;
  /** Pi monotonic clock when the advert arrived, ms. Same clock for every node: use it for grouping. */
  t_ms: number;
  rssi: number | null;
  raw: string;
  src: number;
  msg_id: number;
  hops: number;
  type: 'ALERT' | 'HEARTBEAT';
  alert?: {
    class: AlertClass | string;
    confidence: number;
    /** Tenths of a dB on the calibrated scale (853 = 85.3 dB). */
    peak_level: number;
    peak_db: number;
    timestamp: number;
    blast_count: number;
  };
}

/** GET /health. */
export interface DecoderHealth {
  version: string;
  run_id: string;
  source: string;
  scanner: 'up' | 'starting' | 'down';
  uptime_s: number;
  clients: number;
  counts: Record<string, number>;
}

/** off: not connecting. connecting: first attempt. live: stream open. down: lost, retrying. */
export type LinkState = 'off' | 'connecting' | 'live' | 'down';

/** Reconnect delay after the stream drops, ms (the decoder suggests 2 s too). */
const RETRY_MS = 2000;
/** How often /health is polled, ms. */
const HEALTH_MS = 3000;

/** Normalises what someone typed: adds http://, drops a trailing slash or /events. */
export function normaliseUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Opens the decoder's event stream and polls its health until the returned function is called.
 *
 * On a drop it reconnects from scratch after 2 s rather than letting EventSource resume with
 * Last-Event-ID: a resume replays buffered packets, which would come back as calls that happened
 * minutes ago. Missing a few seconds during a cable blip is the better trade on stage.
 */
export function connectDecoder(
  base: string,
  on: {
    event: (e: DecoderEvent) => void;
    state: (s: LinkState) => void;
    health: (h: DecoderHealth | null) => void;
  },
): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    if (stopped) return;
    es = new EventSource(`${base}/events`);
    es.onopen = () => on.state('live');
    es.addEventListener('packet', (m) => {
      try {
        on.event(JSON.parse((m as MessageEvent<string>).data) as DecoderEvent);
      } catch {
        // a malformed event is skipped; the decoder's own tests guard the format
      }
    });
    es.onerror = () => {
      es?.close();
      es = null;
      if (stopped) return;
      on.state('down');
      retry = setTimeout(open, RETRY_MS);
    };
  };

  const poll = async () => {
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
      if (!stopped) on.health(r.ok ? ((await r.json()) as DecoderHealth) : null);
    } catch {
      if (!stopped) on.health(null);
    }
  };

  on.state('connecting');
  open();
  void poll();
  const healthTimer = setInterval(poll, HEALTH_MS);

  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(healthTimer);
    es?.close();
    on.state('off');
    on.health(null);
  };
}

/** One node's part of a call: the loudest alert it sent within the grouping window. */
export interface Heard {
  src: number;
  /** Tenths of a dB, as on the wire. */
  peak: number;
  cls: string;
  confidence: number;
  hops: number;
}

/** Alerts from different nodes within this long of the first one are one call, ms of Pi time. */
export const GROUP_MS = 2000;

/**
 * Groups ALERT events into calls. Each Serranode that hears a call sends its own alert (own src,
 * own msg_id, own peak_level), so one whistle arrives as up to three alerts within a moment.
 * A group closes GROUP_MS after its first alert, or at once when every expected node is in.
 */
export function createGrouper(
  onGroup: (heard: Heard[]) => void,
  expected: () => number[],
  windowMs = GROUP_MS,
) {
  let t0 = 0;
  let open: Map<number, Heard> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    clearTimeout(timer);
    if (open?.size) onGroup([...open.values()]);
    open = null;
  };

  return {
    push(e: DecoderEvent) {
      if (e.type !== 'ALERT' || !e.alert) return;
      if (open && e.t_ms - t0 > windowMs) flush();
      if (!open) {
        open = new Map();
        t0 = e.t_ms;
        timer = setTimeout(flush, windowMs);
      }
      const h: Heard = {
        src: e.src,
        peak: e.alert.peak_level,
        cls: e.alert.class,
        confidence: e.alert.confidence,
        hops: e.hops,
      };
      const prev = open.get(e.src);
      if (!prev || h.peak > prev.peak) open.set(e.src, h);
      const want = expected();
      if (want.length && want.every((id) => open!.has(id))) flush();
    },
    /** Drops a half-built group (on disconnect). */
    reset() {
      clearTimeout(timer);
      open = null;
    },
  };
}
