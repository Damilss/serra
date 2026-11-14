// Dashboard state (Zustand). Components subscribe to the slices they render; the canvas loops read
// it with getState() every frame, so animation never re-renders React.
//
// Today the data comes from the mock feed (lib/alerts.ts). The live feed will call the same actions
// (addAlert, logPacket, heartbeat) from Supabase Realtime events.

'use client';

import { create } from 'zustand';
import { makeAlert, morningAlert, msgSeq, srcPeak } from './alerts';
import { chime, ensureAudio } from './audio';
import { now } from './format';
import { BASE, FIELD_COUNT, N } from './geo';
import { buildPacket } from './packets';
import type { Alert, AlertClass, AlertStatus, Packet } from './types';

export type Mode = 'ops' | 'rescuer';
export interface ReplayState {
  alertId: number;
  /** Seconds since the call. */
  e: number;
  playing: boolean;
}

interface DashboardState {
  alerts: Alert[];
  packets: Packet[];
  /** A packet the user clicked in the log; null = follow the newest. */
  pinnedId: number | null;
  /** Selected node index (1–5). */
  sel: number;
  /** When the selection changed (now()), for the map's selection ring animation. */
  selT: number;
  simClass: AlertClass;
  mode: Mode;
  soundOn: boolean;
  replay: ReplayState | null;
  /** Seconds since each node was last heard. */
  lastHeard: number[];

  select: (i: number) => void;
  step: (d: number) => void;
  setSimClass: (c: AlertClass) => void;
  simulate: (src: number) => void;
  setStatus: (id: number, status: AlertStatus, note?: string) => void;
  /** Promotes alerts whose flood has reached the base (called every frame). */
  promoteArrivals: () => void;
  startReplay: (id: number) => void;
  exitReplay: () => void;
  toggleReplay: () => void;
  seekReplay: (e: number) => void;
  advanceReplay: (dt: number) => void;
  logPacket: (p: Packet, follow?: boolean) => void;
  pinPacket: (id: number | null) => void;
  heartbeat: (src: number) => void;
  tickSecond: () => void;
  setMode: (m: Mode) => void;
  toggleSound: () => void;
}

const alertPacket = (a: Alert, time = new Date()) =>
  buildPacket(
    a.src,
    {
      kind: 'alert',
      msgId: a.msgId,
      hops: a.hops,
      conf: a.conf,
      peak: srcPeak(a),
      uptime: a.uptime,
      cls: a.cls,
    },
    time,
  );

function initialData() {
  const morning = morningAlert();
  const packets: Packet[] = [];
  // one heartbeat per node and the morning's alert packet, so the packet view isn't empty
  for (let i = 1; i <= FIELD_COUNT; i++) {
    msgSeq[i]++;
    packets.unshift(buildPacket(i, { kind: 'heartbeat', msgId: msgSeq[i], hops: BASE.dist[i] }));
  }
  packets.push(alertPacket(morning, morning.wall));
  return { alerts: [morning], packets };
}

const isOpen = (a: Alert) => a.status === 'active' || a.status === 'ack' || a.status === 'incoming';
/** The open alert (relaying, active or acknowledged), if any. */
export const currentAlert = (alerts: Alert[]) => alerts.find(isOpen);
/** The alert still relaying across the Serranet, if any. */
export const incomingAlert = (alerts: Alert[]) => alerts.find((a) => a.status === 'incoming');
/** The packet shown in the packet view. */
export const shownPacket = (s: Pick<DashboardState, 'packets' | 'pinnedId'>) =>
  s.packets.find((p) => p.id === s.pinnedId) ?? s.packets[0];

export const useDashboard = create<DashboardState>()((set, get) => ({
  ...initialData(),
  pinnedId: null,
  sel: 3,
  selT: 0,
  simClass: 'whistle',
  mode: 'ops',
  soundOn: true,
  replay: null,
  lastHeard: Array.from({ length: N }, (_, i) => 1 + i * 2),

  select: (i) => set({ sel: i, selT: now() }),
  step: (d) => get().select(((get().sel - 1 + d + FIELD_COUNT) % FIELD_COUNT) + 1),
  setSimClass: (simClass) => set({ simClass }),

  simulate: (src) => {
    const { alerts, simClass } = get();
    if (incomingAlert(alerts)) return;
    ensureAudio();
    const superseded = alerts.map((a) =>
      a.status === 'active' || a.status === 'ack'
        ? { ...a, status: 'resolved' as const, note: 'Superseded by a newer alert.' }
        : a,
    );
    set({ alerts: [makeAlert(src, { cls: simClass }), ...superseded], replay: null, sel: src, selT: now() });
  },

  setStatus: (id, status, note) =>
    set({ alerts: get().alerts.map((a) => (a.id === id ? { ...a, status, note: note ?? a.note } : a)) }),

  promoteArrivals: () => {
    const t = now();
    const arrived = get().alerts.filter((a) => a.status === 'incoming' && t - a.start >= a.T);
    if (!arrived.length) return;
    set({ alerts: get().alerts.map((a) => (arrived.includes(a) ? { ...a, status: 'active' } : a)) });
    for (const a of arrived) {
      if (get().soundOn) chime();
      get().logPacket(alertPacket(a), true);
      get().select(a.src);
    }
  },

  startReplay: (id) => {
    const a = get().alerts.find((x) => x.id === id);
    if (!a) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    set({ replay: { alertId: id, e: 0, playing: !reduced }, sel: a.src, selT: now() });
  },
  exitReplay: () => set({ replay: null }),
  toggleReplay: () => {
    const { replay, alerts } = get();
    if (!replay) {
      const last = alerts.find((x) => x.status !== 'incoming');
      if (last) get().startReplay(last.id);
      return;
    }
    const a = alerts.find((x) => x.id === replay.alertId)!;
    set({ replay: { ...replay, e: replay.e >= a.dur - 0.01 ? 0 : replay.e, playing: !replay.playing } });
  },
  seekReplay: (e) => {
    if (!get().replay) {
      const last = get().alerts.find((x) => x.status !== 'incoming');
      if (!last) return;
      get().startReplay(last.id);
    }
    set({ replay: { ...get().replay!, e, playing: false } });
  },
  advanceReplay: (dt) => {
    const { replay, alerts } = get();
    if (!replay?.playing) return;
    const a = alerts.find((x) => x.id === replay.alertId);
    if (!a) return set({ replay: null });
    const e = Math.min(a.dur, replay.e + dt);
    set({ replay: { ...replay, e, playing: e < a.dur } });
  },

  logPacket: (p, follow) =>
    set((s) => ({ packets: [p, ...s.packets].slice(0, 40), pinnedId: follow ? null : s.pinnedId })),
  pinPacket: (pinnedId) => set({ pinnedId }),
  heartbeat: (src) => {
    msgSeq[src]++;
    get().logPacket(buildPacket(src, { kind: 'heartbeat', msgId: msgSeq[src], hops: BASE.dist[src] }));
    set((s) => ({ lastHeard: s.lastHeard.map((v, i) => (i === src ? 0 : v)) }));
  },
  tickSecond: () => set((s) => ({ lastHeard: s.lastHeard.map((v, i) => (i === 0 ? v : v + 1)) })),

  setMode: (mode) => set({ mode }),
  toggleSound: () => {
    ensureAudio();
    set((s) => ({ soundOn: !s.soundOn }));
  },
}));

/** The alert being replayed, if any. */
export const replayAlert = (s: Pick<DashboardState, 'alerts' | 'replay'>) =>
  s.replay ? (s.alerts.find((a) => a.id === s.replay!.alertId) ?? null) : null;
