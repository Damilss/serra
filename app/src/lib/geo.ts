// The Serranet layout: where the nodes are, which ones can hear each other, and map maths.
// Mock data: positions, IDs and battery match app/supabase/seed.sql.

import { pad } from './format';
import type { MapPoint, MeshNode, Serranode } from './types';

/** The map covers GROUND_W × GROUND_H metres of fictional terrain (Hollow Pine Wilderness). */
export const GROUND_W = 2000;
export const GROUND_H = 1250;

/** Index 0 is the base station; 1–5 are Serranodes. */
export const NODES: MeshNode[] = [
  { kind: 'base', name: 'Ranger Station', x: 0.1, y: 0.8, nodeId: 0x0001 },
  {
    kind: 'field',
    num: 1,
    name: 'Lower Creek Trailhead',
    x: 0.26,
    y: 0.64,
    nodeId: 0x1c4e,
    uid: 'E6614C311B2A7D40',
    batt: 92,
    volts: 4.11,
    rssi: -58,
  },
  {
    kind: 'field',
    num: 2,
    name: 'Cedar Switchback',
    x: 0.4,
    y: 0.43,
    nodeId: 0x7b02,
    uid: 'E6614C311B5E1C93',
    batt: 81,
    volts: 4.02,
    rssi: -66,
  },
  {
    kind: 'field',
    num: 3,
    name: 'Falls Overlook',
    x: 0.56,
    y: 0.63,
    nodeId: 0x3a7f,
    uid: 'E6614C311B5A9F2D',
    batt: 64,
    volts: 3.88,
    rssi: -71,
  },
  {
    kind: 'field',
    num: 4,
    name: 'Granite Saddle',
    x: 0.67,
    y: 0.33,
    nodeId: 0xd915,
    uid: 'E6614C311B61F0A8',
    batt: 47,
    volts: 3.79,
    rssi: -77,
  },
  {
    kind: 'field',
    num: 5,
    name: 'Ridge Camp',
    x: 0.85,
    y: 0.19,
    nodeId: 0x52c6,
    uid: 'E6614C311B7342E1',
    batt: 18,
    volts: 3.52,
    rssi: -84,
  },
];
export const N = NODES.length;
export const FIELD_COUNT = N - 1;

/** The Serranode at index i (1–5). */
export const field = (i: number) => NODES[i] as Serranode;
/** "N03" for index 3. */
export const nn = (i: number) => `N${pad(field(i).num)}`;

/** Serranet graph: pairs of NODES indexes that are in BLE range of each other. */
export const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 3],
  [2, 3],
  [2, 4],
  [3, 4],
  [4, 5],
];
const adj: number[][] = NODES.map(() => []);
LINKS.forEach(([a, b]) => {
  adj[a].push(b);
  adj[b].push(a);
});

/** Breadth-first search from one node: hop counts (dist) and the previous hop (prev). */
export function bfs(from: number) {
  const dist = new Array<number>(N).fill(Infinity);
  const prev = new Array<number>(N).fill(-1);
  dist[from] = 0;
  const q = [from];
  while (q.length) {
    const n = q.shift()!;
    for (const m of adj[n])
      if (dist[m] === Infinity) {
        dist[m] = dist[n] + 1;
        prev[m] = n;
        q.push(m);
      }
  }
  return { dist, prev };
}

/** Hops from every node to the base. */
export const BASE = bfs(0);

/** Node indexes from `from` to the base, inclusive. */
export function pathToBase(from: number) {
  const p = [from];
  let c = from;
  while (c !== 0) {
    c = BASE.prev[c];
    p.push(c);
  }
  return p;
}

/** Map fractions → made-up GPS coordinates. */
export const lat = (p: MapPoint) => 35.33 - (p.y * GROUND_H) / 110950;
export const lon = (p: MapPoint) => -120.68 + (p.x * GROUND_W) / 91190;
export const coordStr = (p: MapPoint) => `${lat(p).toFixed(4)}° N, ${Math.abs(lon(p)).toFixed(4)}° W`;
/** 8 × 6 grid reference, A1–H6. */
export const gridRef = (p: MapPoint) =>
  'ABCDEFGH'[Math.max(0, Math.min(7, Math.floor(p.x * 8)))] +
  (Math.max(0, Math.min(5, Math.floor(p.y * 6))) + 1);

const CARD = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/** Compass bearing (degrees + 16-point name) and distance in metres from a to b, for rescuer mode. */
export function bearing(a: MapPoint, b: MapPoint) {
  const dx = (b.x - a.x) * GROUND_W;
  const dy = (b.y - a.y) * GROUND_H;
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return { deg, card: CARD[Math.round(deg / 22.5) % 16], dist: Math.hypot(dx, dy) };
}
