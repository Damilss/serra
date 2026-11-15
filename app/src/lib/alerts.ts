// Alerts: classes, the mock alert generator (sound model + mesh flood timing) and the text the
// dashboard shows for an alert.

import { GROUND_H, GROUND_W, NODES, bfs, field, gridRef } from './geo';
import { db, hm, mulberry, now, pad } from './format';
import { REF_M, TRIGGER_DB, levelAt } from './sound';
import type { Alert, AlertClass, AlertStatus, Reading } from './types';

/** Timing, slowed down so it can be followed by eye: seconds to classify, then per mesh hop. */
export const DETECT = 2.2;
export const HOP = 0.75;

/**
 * Alert classes. id is alert_class_t in firmware/mesh/packet.h (1 whistle, 2 scream, 3 help).
 * bursts: start time of each blast in seconds; shape: where each blast sits on the waveform (start, width).
 */
export const CLS: Record<
  AlertClass,
  { id: number; word: string; title: string; bursts: number[]; shape: [number, number][] }
> = {
  whistle: {
    id: 1,
    word: 'whistle',
    title: 'Whistle heard',
    bursts: [0, 0.6, 1.2],
    shape: [
      [0.2, 0.12],
      [0.42, 0.12],
      [0.64, 0.12],
    ],
  },
  scream: { id: 2, word: 'scream', title: 'Scream heard', bursts: [0], shape: [[0.24, 0.5]] },
  help: {
    id: 3,
    word: 'help',
    title: 'Call for help',
    bursts: [0, 0.55],
    shape: [
      [0.26, 0.14],
      [0.44, 0.2],
    ],
  },
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  incoming: 'Relaying',
  active: 'Active',
  ack: 'Acknowledged',
  resolved: 'Resolved',
};

// Mock counters: alert ids and each node's msg_id sequence (randomly seeded per node on real hardware).
let alertSeq = 0;
export const msgSeq = NODES.map((_, i) => 100 + i * 37);

export interface AlertOptions {
  cls?: AlertClass;
  conf?: number;
  start?: number;
  wall?: Date;
  status?: AlertStatus;
  note?: string;
}

/**
 * Builds one alert as if someone called out next to node `src`:
 *   heard    every node the sound reached above the wake trigger, loudest first, with its delay
 *            (distance / 343 m/s) and peak (tenths of a dB, like peak_level on the wire)
 *   arrival  when the relayed alert reaches each node, flooding hop by hop
 *   est      the loudness-weighted fix and search radius
 * plus mock metadata (confidence, latency, msg_id, uptime).
 */
export function makeAlert(src: number, o: AlertOptions = {}): Alert {
  const { dist } = bfs(src);
  const s = NODES[src];
  const rnd = mulberry(src * 31 + alertSeq * 7 + 3);
  const cls = o.cls ?? 'whistle';
  const arrival = dist.map((d, i) => DETECT + d * HOP + (i === src ? 0 : rnd() * 0.12));
  const heard: Reading[] = [];
  NODES.forEach((n, i) => {
    if (n.kind === 'base') return;
    const d = Math.hypot((n.x - s.x) * GROUND_W, (n.y - s.y) * GROUND_H);
    // sound reaches farther nodes later (343 m/s) and quieter; ±1 dB of jitter on confirming nodes
    const peak = Math.round(levelAt(cls, Math.hypot(d, REF_M)) * 10 + (i === src ? 0 : (rnd() - 0.5) * 20));
    if (peak >= TRIGGER_DB * 10) heard.push({ i, d, delay: Math.min(1.8, d / 343), peak });
  });
  heard.sort((a, b) => b.peak - a.peak);
  // loudness-weighted fix: weight by sound pressure, 10^(dB / 20), not by the dB number itself
  let wx = 0;
  let wy = 0;
  let ws = 0;
  heard.forEach((h) => {
    const w = 10 ** (h.peak / 200);
    wx += NODES[h.i].x * w;
    wy += NODES[h.i].y * w;
    ws += w;
  });
  msgSeq[src]++;
  return {
    id: ++alertSeq,
    src,
    cls,
    arrival,
    T: arrival[0],
    dur: arrival[0] + 1.6,
    heard,
    hops: dist[0],
    est: { x: wx / ws, y: wy / ws, r: 80 + 55 * heard.length },
    conf: o.conf ?? +(0.86 + rnd() * 0.11).toFixed(2),
    start: o.start ?? now(),
    wall: o.wall ?? new Date(),
    status: o.status ?? 'incoming',
    note: o.note ?? '',
    latency: Math.round(dist[0] * 68 + 150 + rnd() * 40),
    msgId: msgSeq[src],
    uptime: Math.round(3.6e6 + rnd() * 4e7),
  };
}

/** This morning's false positive at Ridge Camp, already resolved (matches supabase/seed.sql). */
export function morningAlert() {
  const w = new Date();
  w.setHours(9, 12, 44);
  return makeAlert(5, {
    cls: 'whistle',
    status: 'resolved',
    start: -1e4,
    wall: w,
    conf: 0.62,
    note: 'Resolved. Bird call, false positive.',
  });
}

/** Peak level at the calling node. */
export const srcPeak = (a: Alert) => a.heard.find((h) => h.i === a.src)!.peak;

/** How loud a node heard the call relative to the calling node: 0 at the trigger, 1 as loud. */
export const rel = (a: Alert, h: Reading) =>
  Math.max(0, Math.min(1, (h.peak - TRIGGER_DB * 10) / (srcPeak(a) - TRIGGER_DB * 10)));

/** A piece of the summary sentence; `strong` parts are names shown in bold. */
export type TextPart = { text: string; strong?: boolean };

/** Plain-language sentence for the alert card, feed and rescuer card. */
export function summaryParts(a: Alert): TextPart[] {
  const s = field(a.src);
  const conf = a.heard.filter((h) => h.i !== a.src);
  const what =
    a.cls === 'whistle'
      ? 'Repeated distress whistle, likely 3 blasts,'
      : a.cls === 'scream'
        ? 'A scream,'
        : 'A voice calling “help”,';
  const R = Math.round(a.est.r / 10) * 10;
  const g = gridRef(a.est);
  const parts: TextPart[] = [
    { text: `${what} heard first and loudest by ` },
    { text: `Serranode ${pad(s.num)} · ${s.name}`, strong: true },
    { text: ` (${db(srcPeak(a))} dB) at ${hm(a.wall)}. ` },
  ];
  if (conf.length) {
    parts.push(
      { text: `${conf.length} nearby Serranode${conf.length > 1 ? 's' : ''}`, strong: true },
      {
        text: ` confirmed it more quietly (${conf.map((h) => `${db(h.peak)} dB`).join(', ')}), narrowing the search to about ${R} m around grid ${g}.`,
      },
    );
  } else {
    parts.push({ text: `No other Serranode heard it, so the search covers about ${R} m around grid ${g}.` });
  }
  return parts;
}

export const summary = (a: Alert) =>
  summaryParts(a)
    .map((p) => p.text)
    .join('');

/** The [label, value] rows shown on the alert card. */
export const readings = (a: Alert): [string, string][] => [
  ['Class', CLS[a.cls].word],
  ['Conf.', a.conf.toFixed(2)],
  ['Loudness', `${db(srcPeak(a))} dB`],
  ['Time', hm(a.wall)],
  ['Confirmed by', `${a.heard.length - 1} nodes`],
  ['Hops', String(a.hops)],
];
