// State for the venue demo page (/demo): the triangle layout, the calls located so far, and the live
// link to the base-station decoder. Separate from the field dashboard's store.
//
// Calls come from two places: simulated (click the floor or a taped mark) and live (alerts from the
// decoder, grouped into one call per whistle by lib/decoder.ts, then passed to ingest()).

'use client';

import { create } from 'zustand';
import { PI_URL, type DecoderHealth, type Heard, type LinkState } from './decoder';
import { now } from './format';
import {
  DEFAULT_NODE_IDS,
  makeLayout,
  seeded,
  simulateReadings,
  trilaterate,
  type Fix,
  type VenueLayout,
  type VenueReading,
} from './venue';
import type { MapPoint } from './types';

export interface VenueCall {
  id: number;
  wall: Date;
  /** now() when the call happened, for the map animation. */
  t0: number;
  /** Where the caller really was. Known for simulated calls only. */
  truth: MapPoint | null;
  /** Readings used for the fit, after calibration (tenths of a dB). */
  readings: VenueReading[];
  /** Level each node heard, dB after calibration, by node index; null if that node didn't report. */
  levels: (number | null)[];
  /** peak_level as each node sent it, before calibration (tenths of a dB); null if it didn't report. */
  raw: (number | null)[];
  /** Null when fewer than three nodes heard the call: two readings can't pin a spot. */
  fix: Fix | null;
  /** What the loudest node classified it as. */
  cls: string;
  source: 'simulated' | 'live';
}

/** A Serranode the decoder has heard from, assigned to the triangle or not. */
export interface SeenNode {
  id: number;
  /** Last peak it reported, tenths of a dB. */
  peak: number;
  cls: string;
  at: number;
}

interface VenueState {
  layout: VenueLayout;
  calls: VenueCall[];
  /** Show the true caller position (rehearsal). Off for the live demo. */
  showTruth: boolean;
  /** ±dB of measurement noise on simulated calls. */
  jitterDb: number;
  /** Prefer estimates inside the taped triangle (see trilaterate's insideOnly). */
  insideOnly: boolean;

  /** Mesh IDs at A, B and C. */
  nodeIds: number[];
  /** Whether each corner's ID was set (by hand or by the first new node heard), or is still a default. */
  assigned: boolean[];
  /** Calibration, dB added to each corner's reading so the three agree (see calibrate()). */
  offsets: number[];
  /** Every node the decoder has reported an alert from. */
  seen: Record<number, SeenNode>;

  decoderUrl: string;
  /** Whether the page should be connected to the decoder. */
  liveOn: boolean;
  link: LinkState;
  health: DecoderHealth | null;
  /** now() of the last packet of any kind from the decoder. */
  lastPacketAt: number | null;

  setSideFt: (ft: number) => void;
  setShowTruth: (on: boolean) => void;
  setJitter: (db: number) => void;
  setInsideOnly: (on: boolean) => void;
  /** Simulates a call at `p` (click on the floor, or a taped mark). */
  simulateAt: (p: MapPoint) => void;
  /** Adds a call from one group of live alerts. */
  ingest: (heard: Heard[]) => void;
  /** Puts node `id` at corner `i` (swapping, if it was at another corner). */
  setNodeId: (i: number, id: number) => void;
  /** Forgets the corner assignments, so the next nodes heard are assigned in order again. */
  resetNodeIds: () => void;
  /**
   * Uses the latest live call, made standing at the centre mark (equally far from all three nodes),
   * to even out the nodes: each gets the offset that brings it to the three's average.
   */
  calibrate: () => boolean;
  resetCalibration: () => void;
  setDecoderUrl: (url: string) => void;
  setLiveOn: (on: boolean) => void;
  setLink: (link: LinkState) => void;
  setHealth: (health: DecoderHealth | null) => void;
  packetSeen: () => void;
  clear: () => void;
}

// ── per-browser settings: decoder address, node IDs, calibration ──

const KEY = 'serra.venue.v1';
interface Saved {
  decoderUrl: string;
  liveOn: boolean;
  nodeIds: number[];
  assigned: boolean[];
  offsets: number[];
}
function load(): Partial<Saved> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    const ok3 = (a: unknown, t: string) =>
      Array.isArray(a) && a.length === 3 && a.every((v) => typeof v === t);
    return {
      decoderUrl: typeof s.decoderUrl === 'string' ? s.decoderUrl : undefined,
      liveOn: typeof s.liveOn === 'boolean' ? s.liveOn : undefined,
      nodeIds: ok3(s.nodeIds, 'number') ? s.nodeIds : undefined,
      assigned: ok3(s.assigned, 'boolean') ? s.assigned : undefined,
      offsets: ok3(s.offsets, 'number') ? s.offsets : undefined,
    };
  } catch {
    return {};
  }
}
function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private window or blocked storage: settings just don't survive a reload
  }
}

/** ?decoder=host:port in the page URL overrides the saved address and connects (handy for tests). */
function fromQuery(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('decoder');
  } catch {
    return null;
  }
}

const saved = typeof window === 'undefined' ? {} : load();
const query = typeof window === 'undefined' ? null : fromQuery();
const startIds = saved.nodeIds ?? DEFAULT_NODE_IDS;

let seq = 0;
let rnd = seeded(2026);

export const useVenue = create<VenueState>()((set, get) => {
  const persist = () => {
    const s = get();
    save({
      decoderUrl: s.decoderUrl,
      liveOn: s.liveOn,
      nodeIds: s.nodeIds,
      assigned: s.assigned,
      offsets: s.offsets,
    });
  };
  const push = (call: VenueCall) => set((s) => ({ calls: [call, ...s.calls].slice(0, 20) }));
  const withIds = (nodeIds: number[]) => set({ nodeIds, layout: makeLayout(get().layout.sideFt, nodeIds) });

  return {
    layout: makeLayout(20, startIds),
    calls: [],
    showTruth: true,
    jitterDb: 1,
    insideOnly: true,

    nodeIds: startIds,
    assigned: saved.assigned ?? [false, false, false],
    offsets: saved.offsets ?? [0, 0, 0],
    seen: {},

    decoderUrl: query ?? saved.decoderUrl ?? PI_URL,
    liveOn: query ? true : (saved.liveOn ?? false),
    link: 'off',
    health: null,
    lastPacketAt: null,

    setSideFt: (ft) => {
      if (!Number.isFinite(ft) || ft < 5 || ft > 200) return;
      set({ layout: makeLayout(ft, get().nodeIds), calls: [] });
    },
    setShowTruth: (showTruth) => set({ showTruth }),
    setJitter: (jitterDb) => set({ jitterDb }),
    setInsideOnly: (insideOnly) => set({ insideOnly }),

    simulateAt: (p) => {
      const { layout, jitterDb, insideOnly } = get();
      const readings = simulateReadings(layout, p, rnd, jitterDb);
      push({
        id: ++seq,
        wall: new Date(),
        t0: now(),
        truth: p,
        readings,
        levels: readings.map((r) => r.peak / 10),
        raw: readings.map((r) => r.peak),
        fix: trilaterate(layout, readings, { insideOnly }),
        cls: 'whistle',
        source: 'simulated',
      });
    },

    ingest: (heard) => {
      if (!heard.length) return;
      // Remember every node heard, and give any corner still on a default ID to a new node.
      const seen = { ...get().seen };
      for (const h of heard) seen[h.src] = { id: h.src, peak: h.peak, cls: h.cls, at: now() };
      set({ seen });
      const ids = [...get().nodeIds];
      const assigned = [...get().assigned];
      let changed = false;
      for (const h of heard) {
        if (ids.includes(h.src) && assigned[ids.indexOf(h.src)]) continue;
        const free = ids.includes(h.src) ? ids.indexOf(h.src) : assigned.indexOf(false);
        if (free < 0) continue;
        ids[free] = h.src;
        assigned[free] = true;
        changed = true;
      }
      if (changed) {
        set({ assigned });
        withIds(ids);
        persist();
      }

      const { layout, offsets, insideOnly } = get();
      const raw: (number | null)[] = ids.map((id) => heard.find((h) => h.src === id)?.peak ?? null);
      const levels = raw.map((p, i) => (p === null ? null : p / 10 + offsets[i]));
      const readings: VenueReading[] = [];
      levels.forEach((l, i) => l !== null && readings.push({ node: i, peak: Math.round(l * 10) }));
      const loudest = heard.reduce((a, h) => (h.peak > a.peak ? h : a));
      push({
        id: ++seq,
        wall: new Date(),
        t0: now(),
        truth: null,
        readings,
        levels,
        raw,
        fix: readings.length === 3 ? trilaterate(layout, readings, { insideOnly }) : null,
        cls: loudest.cls,
        source: 'live',
      });
    },

    setNodeId: (i, id) => {
      const ids = [...get().nodeIds];
      const assigned = [...get().assigned];
      const j = ids.indexOf(id);
      if (j >= 0 && j !== i) {
        ids[j] = ids[i];
        assigned[j] = assigned[i];
      }
      ids[i] = id;
      assigned[i] = true;
      set({ assigned });
      withIds(ids);
      persist();
    },
    resetNodeIds: () => {
      set({ assigned: [false, false, false] });
      withIds(DEFAULT_NODE_IDS);
      persist();
    },

    calibrate: () => {
      const call = get().calls.find((c) => c.source === 'live');
      if (!call || call.raw.some((p) => p === null)) return false;
      const db = call.raw.map((p) => p! / 10);
      const mean = db.reduce((a, b) => a + b, 0) / db.length;
      set({ offsets: db.map((v) => Math.round((mean - v) * 10) / 10) });
      persist();
      return true;
    },
    resetCalibration: () => {
      set({ offsets: [0, 0, 0] });
      persist();
    },

    setDecoderUrl: (decoderUrl) => {
      set({ decoderUrl });
      persist();
    },
    setLiveOn: (liveOn) => {
      set({ liveOn });
      persist();
    },
    setLink: (link) => set({ link }),
    setHealth: (health) => set({ health }),
    packetSeen: () => set({ lastPacketAt: now() }),

    clear: () => {
      rnd = seeded(2026);
      set({ calls: [] });
    },
  };
});
