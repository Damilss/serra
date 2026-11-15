// Fictional terrain for the map and the welcome screen: a sum of Gaussian hills, drawn as contour
// lines with marching squares.

import type { MapPoint } from './types';

export interface Peak {
  x: number;
  y: number;
  r: number;
  /** Height; negative is a valley. */
  a: number;
  /** Optional slow drift (welcome screen): amplitude, speed and phase. */
  dx?: number;
  dy?: number;
  s?: number;
  ph?: number;
}

export const PEAKS: Peak[] = [
  { x: 0.74, y: 0.22, r: 0.2, a: 1.0 },
  { x: 0.48, y: 0.38, r: 0.15, a: 0.62 },
  { x: 0.16, y: 0.2, r: 0.22, a: 0.55 },
  { x: 0.9, y: 0.7, r: 0.17, a: 0.55 },
  { x: 0.36, y: 0.9, r: 0.24, a: -0.35 },
  { x: 0.62, y: 0.68, r: 0.1, a: 0.3 },
];

/** Height at (x, y) in map fractions; `ar` is the width / height aspect ratio, `t` drives drift. */
export function heightAt(x: number, y: number, ar: number, t = 0, peaks = PEAKS) {
  let v = 0;
  for (const p of peaks) {
    const px = p.x + (p.dx || 0) * Math.sin(t * (p.s || 0) + (p.ph || 0));
    const py = p.y + (p.dy || 0) * Math.cos(t * (p.s || 0) * 0.8 + (p.ph || 0));
    const dx = (x - px) * ar;
    const dy = y - py;
    v += p.a * Math.exp(-(dx * dx + dy * dy) / (p.r * p.r));
  }
  return v + 0.03 * Math.sin(x * 7 + y * 3 + t * 0.25);
}

/** Elevation in metres at a map point (1500 m base). */
export const elevation = (p: MapPoint) => Math.round(1500 + heightAt(p.x, p.y, 1.6) * 1000);

/** 30 contour levels, 50 m apart. */
export const LEVELS = Array.from({ length: 30 }, (_, i) => -0.3 + i * 0.05);

// Marching squares: for each corner pattern, which cell edges (0 top, 1 right, 2 bottom, 3 left) a line joins.
const SEG: Record<number, [number, number][]> = {
  1: [[3, 2]],
  2: [[2, 1]],
  3: [[3, 1]],
  4: [[0, 1]],
  5: [
    [0, 1],
    [3, 2],
  ],
  6: [[0, 2]],
  7: [[0, 3]],
  8: [[0, 3]],
  9: [[0, 2]],
  10: [
    [0, 3],
    [2, 1],
  ],
  11: [[0, 1]],
  12: [[3, 1]],
  13: [[1, 2]],
  14: [[3, 2]],
};

/** Draws one contour line per value in `levels`, sampling the height field every `cell` pixels. */
export function contours(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cell: number,
  t: number,
  peaks: Peak[],
  levels: number[],
  style: (ctx: CanvasRenderingContext2D, k: number, level: number) => void,
) {
  const nx = Math.ceil(W / cell) + 1;
  const ny = Math.ceil(H / cell) + 1;
  const ar = W / H;
  const f = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) f[j * nx + i] = heightAt((i * cell) / W, (j * cell) / H, ar, t, peaks);
  const lerp = (a: number, b: number, L: number) => (L - a) / (b - a || 1e-6);
  levels.forEach((L, k) => {
    ctx.beginPath();
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const tl = f[j * nx + i];
        const tr = f[j * nx + i + 1];
        const br = f[(j + 1) * nx + i + 1];
        const bl = f[(j + 1) * nx + i];
        const c = (+(tl > L) << 3) | (+(tr > L) << 2) | (+(br > L) << 1) | +(bl > L);
        if (c === 0 || c === 15) continue;
        const x0 = i * cell;
        const y0 = j * cell;
        const pt = (e: number): [number, number] =>
          e === 0
            ? [x0 + lerp(tl, tr, L) * cell, y0]
            : e === 1
              ? [x0 + cell, y0 + lerp(tr, br, L) * cell]
              : e === 2
                ? [x0 + lerp(bl, br, L) * cell, y0 + cell]
                : [x0, y0 + lerp(tl, bl, L) * cell];
        for (const [a, b] of SEG[c]) {
          const p = pt(a);
          const q = pt(b);
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        }
      }
    style(ctx, k, L);
    ctx.stroke();
  });
}

/** Strokes a polyline as a smooth curve through its points (Catmull-Rom as Béziers). */
export function smooth(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    );
  }
}
