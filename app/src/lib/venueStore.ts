// State for the venue demo page (/demo): the triangle layout, the calls detected so far, and the live
// link to the base-station decoder. Separate from the field dashboard's store.
//
// Detect-only demo: a call shows that the Serranodes heard it, classified it on the device, flooded
// an alert across the mesh, and that the base station received it. It is not located on the floor
// (loudness trilateration was too unreliable indoors; lib/venue.ts still has it for later).
//
// Calls come from two places: simulated (click the floor or a taped mark) and live (alerts from the
// decoder, grouped into one call per whistle by lib/decoder.ts, then passed to ingest()).

'use client';

import { create } from 'zustand';
import { PI_URL, type DecoderHealth, type Heard, type LinkState } from './decoder';
import { now } from './format';
import { DEFAULT_NODE_IDS, dist, makeLayout, seeded, simulateReadings, type VenueLayout } from './venue';
import type { MapPoint } from './types';

export interface VenueCall {
  id: number;
  wall: Date;
  /** now() when the call happened, for the map animation. */
  t0: number;
  /** Where the caller stood. Known for simulated calls only, to animate the sound reaching each node. */
  truth: MapPoint | null;
  /** Level each corner's node heard, dB, by corner index; null if that node didn't report. */
  levels: (number | null)[];
  /** Class each node's own classifier reported, by corner index; null if it didn't report. */
  classes: (string | null)[];
  /** Classifier confidence each node reported, 0–1, by corner index. */
  confidence: (number | null)[];
  /** Relays each node's alert took to reach the base station (0 = heard directly), by corner index. */
  hops: (number | null)[];
  /** What the node that heard it loudest classified it as. */
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
  /** Mark where a simulated caller stood (rehearsal). */
  showTruth: boolean;
  /** ±dB of measurement noise on simulated calls. */
  jitterDb: number;

  /** Mesh IDs at A, B and C. */
  nodeIds: number[];
  /** Whether each corner's ID was set (by hand or by the first new node heard), or is still a default. */
  assigned: boolean[];
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
  /**
   * Simulates a call at `p` (click on the floor, or a taped mark), for rehearsal. Does nothing while
   * connected to the live decoder, so a stray click can't put a made-up caller on screen.
   */
  simulateAt: (p: MapPoint) => void;
  /** Adds a call from one group of live alerts. */
  ingest: (heard: Heard[]) => void;
  /** Puts node `id` at corner `i` (swapping, if it was at another corner). */
  setNodeId: (i: number, id: number) => void;
  /** Forgets the corner assignments, so the next nodes heard are assigned in order again. */
  resetNodeIds: () => void;
  setDecoderUrl: (url: string) => void;
  setLiveOn: (on: boolean) => void;
  setLink: (link: LinkState) => void;
  setHealth: (health: DecoderHealth | null) => void;
  packetSeen: () => void;
  clear: () => void;
}

// ── per-browser settings: decoder address, node IDs ──

const KEY = 'serra.venue.v1';
interface Saved {
  decoderUrl: string;
  liveOn: boolean;
  nodeIds: number[];
  assigned: boolean[];
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
    save({ decoderUrl: s.decoderUrl, liveOn: s.liveOn, nodeIds: s.nodeIds, assigned: s.assigned });
  };
  const push = (call: VenueCall) => set((s) => ({ calls: [call, ...s.calls].slice(0, 20) }));
  const withIds = (nodeIds: number[]) => set({ nodeIds, layout: makeLayout(get().layout.sideFt, nodeIds) });

  return {
    layout: makeLayout(20, startIds),
    calls: [],
    showTruth: true,
    jitterDb: 1,

    nodeIds: startIds,
    assigned: saved.assigned ?? [false, false, false],
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

    simulateAt: (p) => {
      if (get().liveOn) return;
      const { layout, jitterDb } = get();
      const levels = simulateReadings(layout, p, rnd, jitterDb).map((r) => r.peak / 10);
      // every node hears and classifies it; the node farthest from the base needs one relay
      const far = Math.max(...layout.nodes.map((n) => dist(n, layout.base)));
      push({
        id: ++seq,
        wall: new Date(),
        t0: now(),
        truth: p,
        levels,
        classes: layout.nodes.map(() => 'whistle'),
        confidence: layout.nodes.map(() => Math.round((0.86 + rnd() * 0.12) * 100) / 100),
        hops: layout.nodes.map((n) => (dist(n, layout.base) === far ? 1 : 0)),
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

      const byCorner = ids.map((id) => heard.find((h) => h.src === id) ?? null);
      const loudest = heard.reduce((a, h) => (h.peak > a.peak ? h : a));
      push({
        id: ++seq,
        wall: new Date(),
        t0: now(),
        truth: null,
        levels: byCorner.map((h) => (h ? h.peak / 10 : null)),
        classes: byCorner.map((h) => h?.cls ?? null),
        confidence: byCorner.map((h) => h?.confidence ?? null),
        hops: byCorner.map((h) => h?.hops ?? null),
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

    setDecoderUrl: (decoderUrl) => {
      set({ decoderUrl });
      persist();
    },
    setLiveOn: (liveOn) => {
      // going live drops rehearsal calls, so no simulated caller is left on the floor
      set(liveOn ? { liveOn, calls: [] } : { liveOn });
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
