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
  /** u16 mesh ID (the packet's src). */
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
 * Equilateral triangle with A bottom-left, B bottom-right, C at the top. The default node IDs are the
 * decoder simulator's (serra-base --source sim, and npm run mock:decoder); the live panel assigns the
 * real ones as the Serranodes are heard.
 */
export const DEFAULT_NODE_IDS = [0x1c4e, 0x2a10, 0x3b7f];

export function makeLayout(sideFt = 20, nodeIds: number[] = DEFAULT_NODE_IDS): VenueLayout {
  const s = sideFt * FT;
  const h = (s * Math.sqrt(3)) / 2;
  const A = { label: 'A' as const, nodeId: nodeIds[0], x: MARGIN, y: MARGIN + h };
  const B = { label: 'B' as const, nodeId: nodeIds[1], x: MARGIN + s, y: MARGIN + h };
  const C = { label: 'C' as const, nodeId: nodeIds[2], x: MARGIN + s / 2, y: MARGIN };
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
/**
 * Two dips in the error surface are one solution unless the ridge between them rises at least this
 * far above the higher dip, dB². Keeps a long flat valley (a big triangle) from splitting in two.
 */
const BASIN_DB2 = 0.25;
/** The grid never gets finer than this many cells across, so a 200 ft triangle stays fast. */
const MAX_CELLS = 400;
/**
 * With insideOnly, squared error added per metre a spot lies outside the taped triangle, dB²/m.
 * Near a node, noise can make a "mirror" spot just outside the triangle fit slightly better than the
 * real one; this nudge keeps the estimate inside when the two are close calls. In simulation it cut the
 * worst miss at ±1 dB from 7.4 ft to 2.6 ft on a 20 ft triangle. Calls really made outside get pulled
 * to the edge, so it can be switched off.
 */
const OUTSIDE_DB2_PER_M = 1;

/** How far `p` lies outside the triangle `tri`, metres (0 inside). */
function outsideBy(tri: MapPoint[], p: MapPoint) {
  let inside = true;
  let nearest = Infinity;
  for (let i = 0; i < 3; i++) {
    const [a, b, c] = [tri[i], tri[(i + 1) % 3], tri[(i + 2) % 3]];
    const side = (q: MapPoint) => (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
    if (Math.sign(side(p)) !== Math.sign(side(c))) inside = false;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    nearest = Math.min(nearest, Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y)));
  }
  return inside ? 0 : nearest;
}

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
 * Three readings often fit two separate spots about equally well: the real one and a "mirror" spot
 * farther from every node, which needs a louder caller. So the error surface is first split into its
 * separate solutions (basins around each dip), and only then is the tie broken: of the solutions that
 * fit about as well as the best, the one needing the quietest caller wins, and the runner-up is
 * reported as `alt` so the UI can say it can't tell them apart.
 *
 * With `insideOnly`, spots outside the taped triangle score slightly worse (see OUTSIDE_DB2_PER_M).
 *
 * Needs no clock sync: only peak levels, which the firmware already sends.
 */
export function trilaterate(
  layout: VenueLayout,
  readings: VenueReading[],
  { insideOnly = false, step = 0.05, slackDb2 = 3 } = {},
): Fix {
  const levels = readings.map((r) => r.peak / 10);
  const nodes = readings.map((r) => layout.nodes[r.node]);
  step = Math.max(step, Math.max(layout.width, layout.height) / MAX_CELLS);
  const nx = Math.floor(layout.width / step) + 1;
  const ny = Math.floor(layout.height / step) + 1;
  const err = new Float64Array(nx * ny);
  const l0s = new Float64Array(nx * ny);
  const at = (k: number): MapPoint => ({ x: (k % nx) * step, y: Math.floor(k / nx) * step });
  let minErr = Infinity;
  for (let k = 0; k < nx * ny; k++) {
    const p = at(k);
    const loss = nodes.map((n) => spread(dist(n, p)));
    const l0 = levels.reduce((s, v, i) => s + v + loss[i], 0) / levels.length;
    err[k] = levels.reduce((s, v, i) => s + (v - (l0 - loss[i])) ** 2, 0);
    if (insideOnly) err[k] += OUTSIDE_DB2_PER_M * outsideBy(layout.nodes, p);
    l0s[k] = l0;
    minErr = Math.min(minErr, err[k]);
  }
  const neighbours = (k: number) => {
    const x = k % nx;
    const y = Math.floor(k / nx);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && x + dx >= 0 && x + dx < nx && y + dy >= 0 && y + dy < ny)
          out.push(k + dy * nx + dx);
    return out;
  };

  // 1. The dips: grid cells no worse than any neighbour, and within the tie of the best fit.
  const dips: number[] = [];
  for (let k = 0; k < nx * ny; k++) {
    if (err[k] <= minErr + TIE_DB2 && neighbours(k).every((j) => err[k] <= err[j])) dips.push(k);
  }
  dips.sort((a, b) => err[a] - err[b]);

  // 2. Group dips into basins: flood out from each dip (best first) up to BASIN_DB2 above it. A dip
  // already reached by an earlier flood, or whose flood reaches an earlier basin, belongs to it.
  const basinOf = new Int32Array(nx * ny).fill(-1);
  const basins: number[] = []; // best cell of each basin
  for (const d of dips) {
    if (basinOf[d] >= 0) continue;
    const level = err[d] + BASIN_DB2;
    const seen = new Set([d]);
    const queue = [d];
    let joins = -1;
    for (let q = 0; q < queue.length && joins < 0; q++) {
      for (const j of neighbours(queue[q])) {
        if (seen.has(j) || err[j] > level) continue;
        if (basinOf[j] >= 0) {
          joins = basinOf[j];
          break;
        }
        seen.add(j);
        queue.push(j);
      }
    }
    const id = joins >= 0 ? joins : basins.push(d) - 1;
    for (const j of seen) basinOf[j] = id;
  }

  // 3. Break the tie between basins: the quietest caller wins; the best of the rest is the alternative.
  const bestK = basins.reduce((a, k) => (l0s[k] < l0s[a] ? k : a));
  const rest = basins.filter((k) => k !== bestK);
  const altK = rest.length ? rest.reduce((a, k) => (err[k] < err[a] ? k : a)) : -1;
  const best = at(bestK);
  const alt = altK >= 0 ? at(altK) : null;

  // Uncertainty: spots on the estimate's side that fit nearly as well, as a circle of the same area.
  let within = 0;
  for (let k = 0; k < nx * ny; k++) {
    if (err[k] > err[bestK] + slackDb2) continue;
    const p = at(k);
    if (!alt || dist(p, best) < dist(p, alt)) within++;
  }
  const r = Math.max(0.15, Math.sqrt((within * step * step) / Math.PI));
  return {
    ...best,
    r,
    l0: l0s[bestK],
    err: err[bestK],
    predicted: nodes.map((n) => l0s[bestK] - spread(dist(n, best))),
    alt,
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
