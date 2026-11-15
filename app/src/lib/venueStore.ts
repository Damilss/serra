// State for the venue demo page (/demo): the triangle layout and the calls located so far.
// Separate from the field dashboard's store; the live feed will add calls with addCall().

'use client';

import { create } from 'zustand';
import { now } from './format';
import {
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
  readings: VenueReading[];
  fix: Fix;
  source: 'simulated' | 'live';
}

interface VenueState {
  layout: VenueLayout;
  calls: VenueCall[];
  /** Show the true caller position (rehearsal). Off for the live demo. */
  showTruth: boolean;
  /** ±dB of measurement noise on simulated calls. */
  jitterDb: number;
  setSideFt: (ft: number) => void;
  setShowTruth: (on: boolean) => void;
  setJitter: (db: number) => void;
  /** Simulates a call at `p` (click on the floor, or a taped mark). */
  simulateAt: (p: MapPoint) => void;
  /** Adds a call from real readings (live feed). */
  addCall: (readings: VenueReading[]) => void;
  clear: () => void;
}

let seq = 0;
let rnd = seeded(2026);

export const useVenue = create<VenueState>()((set, get) => ({
  layout: makeLayout(20),
  calls: [],
  showTruth: true,
  jitterDb: 1,

  setSideFt: (ft) => {
    if (!Number.isFinite(ft) || ft < 5 || ft > 200) return;
    set({ layout: makeLayout(ft), calls: [] });
  },
  setShowTruth: (showTruth) => set({ showTruth }),
  setJitter: (jitterDb) => set({ jitterDb }),

  simulateAt: (p) => {
    const { layout, jitterDb } = get();
    const readings = simulateReadings(layout, p, rnd, jitterDb);
    const call: VenueCall = {
      id: ++seq,
      wall: new Date(),
      t0: now(),
      truth: p,
      readings,
      fix: trilaterate(layout, readings),
      source: 'simulated',
    };
    set((s) => ({ calls: [call, ...s.calls].slice(0, 20) }));
  },

  addCall: (readings) => {
    const call: VenueCall = {
      id: ++seq,
      wall: new Date(),
      t0: now(),
      truth: null,
      readings,
      fix: trilaterate(get().layout, readings),
      source: 'live',
    };
    set((s) => ({ calls: [call, ...s.calls].slice(0, 20) }));
  },

  clear: () => {
    rnd = seeded(2026);
    set({ calls: [] });
  },
}));
