// Venue demo: three Serranodes on a taped equilateral triangle, and the loudness trilateration that
// estimates where a call came from.
//
// Coordinates are metres on the floor, origin top-left of the drawn area, y pointing down (screen
// order). The UI shows feet, since the triangle is laid out in feet.

import type { MapPoint } from './types';

export const FT = 0.3048;
export const toFt = (m: number) => m / FT;

export interface VenueNode extends MapPoint {
  label: 'A' | 'B' | 'C';
  /** u16 mesh ID. Placeholders until firmware prints the real ones at boot. */
  nodeId: number;
}

export interface VenueLayout {
  sideFt: number;
  nodes: VenueNode[];
  /** Drawn floor area, metres. */
  width: number;
  height: number;
  /** Taped marks to stand on, for rehearsal and the demo. */
  marks: (MapPoint & { label: string; name: string })[];
  /** Where the base station / laptop sits (drawn only). */
  base: MapPoint;
}

/** Margin around the triangle, metres. */
const MARGIN = 1.6;

/**
 * Equilateral triangle with A bottom-left, B bottom-right, C at the top. Node IDs are placeholders;
 * swap in the real ones (and real measured positions, if the triangle isn't perfect) at the venue.
 */
export function makeLayout(sideFt = 20): VenueLayout {
  const s = sideFt * FT;
  const h = (s * Math.sqrt(3)) / 2;
  const A = { label: 'A' as const, nodeId: 0x1c4e, x: MARGIN, y: MARGIN + h };
  const B = { label: 'B' as const, nodeId: 0x7b02, x: MARGIN + s, y: MARGIN + h };
  const C = { label: 'C' as const, nodeId: 0x3a7f, x: MARGIN + s / 2, y: MARGIN };
  const centre = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 };
  const mid = (p: MapPoint, q: MapPoint, k = 0.5) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  return {
    sideFt,
    nodes: [A, B, C],
    width: s + 2 * MARGIN,
    height: h + 2 * MARGIN,
    base: { x: s + 2 * MARGIN - 0.6, y: h + 2 * MARGIN - 0.5 },
    marks: [
      { label: 'X1', name: 'Centre', ...centre },
      { label: 'X2', name: 'Near A', ...mid(A, centre, 0.25) },
      { label: 'X3', name: 'Edge B–C', ...mid(B, C) },
      { label: 'X4', name: 'Outside', x: MARGIN + s + 0.9, y: MARGIN + 0.5 },
    ],
  };
}

export const dist = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Closer than this, the inverse-square model breaks down (the mic is in the near field). */
const MIN_D = 0.3;
const spread = (d: number) => 20 * Math.log10(Math.max(d, MIN_D));

/** Fits within this much squared error of the best count as equally good, dB². */
const TIE_DB2 = 1;
/** Radius of one solution lobe, metres. */
const LOBE_M = 1.2;

/** One node's reading of a call: peak_level as on the wire, tenths of a dB. */
export interface VenueReading {
  node: number;
  peak: number;
}

/** A whistle blast at 1 m, on the calibrated scale (the reference tone reads 80 dB at 1 m). */
export const CALL_DB_1M = 100;

/**
 * Simulates the three nodes hearing a call at `p`: inverse-square falloff from CALL_DB_1M plus
 * ±`jitterDb` of measurement noise, rounded to tenths of a dB like the firmware sends.
 */
export function simulateReadings(
  layout: VenueLayout,
  p: MapPoint,
  rnd: () => number,
  jitterDb = 1,
): VenueReading[] {
  return layout.nodes.map((n, i) => ({
    node: i,
    peak: Math.round((CALL_DB_1M - spread(dist(n, p)) + (rnd() - 0.5) * 2 * jitterDb) * 10),
  }));
}

export interface Fix extends MapPoint {
  /** Radius of the area that fits about as well as the best point, metres. */
  r: number;
  /** Estimated level of the call at 1 m, dB. */
  l0: number;
  /** Squared error of the best fit, dB². */
  err: number;
  /** Level the fit predicts at each node, dB. */
  predicted: number[];
  /**
   * A second spot that explains the readings about as well (usually outside the triangle), or null.
   * When set, three nodes can't tell the two apart: say so rather than trust the estimate.
   */
  alt: MapPoint | null;
}

/**
 * Loudness trilateration. For every point on a grid over the floor, assume the call came from there,
 * find the call level L0 that best explains all readings (the mean of level + spreading loss), and
 * score the leftover squared error. The best point is the estimate; every point within `slackDb2` of
 * it forms the uncertainty area, reported as the radius of a circle with the same area.
 *
 * Needs no clock sync: only peak levels, which the firmware already sends.
 */
export function trilaterate(layout: VenueLayout, readings: VenueReading[], step = 0.05, slackDb2 = 3): Fix {
  const levels = readings.map((r) => r.peak / 10);
  const nodes = readings.map((r) => layout.nodes[r.node]);
  const grid: { x: number; y: number; err: number; l0: number }[] = [];
  let minErr = Infinity;
  for (let x = 0; x <= layout.width; x += step) {
    for (let y = 0; y <= layout.height; y += step) {
      const loss = nodes.map((n) => spread(dist(n, { x, y })));
      const l0 = levels.reduce((s, v, i) => s + v + loss[i], 0) / levels.length;
      const err = levels.reduce((s, v, i) => s + (v - (l0 - loss[i])) ** 2, 0);
      grid.push({ x, y, err, l0 });
      minErr = Math.min(minErr, err);
    }
  }
  // Three readings usually fit two spots equally well: the real one and a "mirror" spot farther from
  // every node, which would need a louder caller. Of the near-equal fits, the quietest caller picks
  // the lobe; the estimate is the best fit within that lobe.
  const good = grid.filter((g) => g.err <= minErr + TIE_DB2);
  const seed = good.reduce((a, g) => (g.l0 < a.l0 ? g : a));
  const inLobe = (g: MapPoint, c: MapPoint) => dist(g, c) <= LOBE_M;
  const best = grid.filter((g) => inLobe(g, seed)).reduce((a, g) => (g.err < a.err ? g : a));
  // The other lobe, if it fits about as well: then the readings can't tell the two spots apart.
  const others = good.filter((g) => dist(g, best) > 2 * LOBE_M);
  const alt = others.length ? others.reduce((a, g) => (g.err < a.err ? g : a)) : null;
  // Uncertainty: spots in this lobe that fit nearly as well, as a circle of the same area.
  const within = grid.filter(
    (g) => g.err <= best.err + slackDb2 && (!alt || dist(g, best) < dist(g, alt)),
  ).length;
  const r = Math.max(0.15, Math.sqrt((within * step * step) / Math.PI));
  return {
    x: best.x,
    y: best.y,
    r,
    l0: best.l0,
    err: best.err,
    predicted: nodes.map((n) => best.l0 - spread(dist(n, best))),
    alt: alt && { x: alt.x, y: alt.y },
  };
}

/** Seeded random, so a rehearsal can be repeated exactly. */
export function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
