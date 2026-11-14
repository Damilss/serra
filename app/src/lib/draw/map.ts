// Map renderer (canvas). Ported from the mockup's drawMap / drawAlert.
//
// Layers: a static terrain layer drawn once per resize into an offscreen canvas, then every frame:
// mesh links, the route from the selected node to the base, heartbeat dots, the live or replayed
// alert, the nodes with labels, and the selection ring.

import { CLS, rel } from '../alerts';
import { A, C, monoFont, sizeCanvas } from '../brand';
import { db, pad } from '../format';
import { GROUND_H, GROUND_W, LINKS, NODES, bfs, pathToBase } from '../geo';
import { LEVELS, PEAKS, contours, heightAt, smooth } from '../terrain';
import type { Alert, MapPoint } from '../types';

export interface MapFrame {
  /** now() in seconds. */
  t: number;
  dt: number;
  sel: number;
  selT: number;
  /** The live open alert, if any. */
  live: Alert | null;
  /** The replayed alert and seconds since its call, if replaying. */
  replay: { a: Alert; e: number } | null;
  reducedMotion: boolean;
}

interface Heartbeat {
  src: number;
  path: number[];
  seg: number;
  p: number;
}

export function createMapRenderer(cv: HTMLCanvasElement, onHeartbeat: (src: number) => void) {
  let ctx: CanvasRenderingContext2D | null = null;
  let off: HTMLCanvasElement | null = null;
  let MW = 0;
  let MH = 0;
  let hbs: Heartbeat[] = [];
  let lastSpawn = 0;

  const P = (n: MapPoint): [number, number] => [n.x * MW, n.y * MH];

  /** Terrain shading, contours, creek, trail, elevation labels and grid letters. */
  function renderStatic() {
    off = document.createElement('canvas');
    const o = sizeCanvas(off, MW, MH);
    o.fillStyle = C.night;
    o.fillRect(0, 0, MW, MH);
    o.strokeStyle = A(C.moss, 0.07);
    o.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const x = Math.round((i * MW) / 8) + 0.5;
      o.beginPath();
      o.moveTo(x, 0);
      o.lineTo(x, MH);
      o.stroke();
    }
    for (let j = 1; j < 6; j++) {
      const y = Math.round((j * MH) / 6) + 0.5;
      o.beginPath();
      o.moveTo(0, y);
      o.lineTo(MW, y);
      o.stroke();
    }
    contours(o, MW, MH, 5, 0, PEAKS, LEVELS, (c, k) => {
      const idx = k % 5 === 0;
      c.lineWidth = idx ? 1.3 : 0.8;
      c.strokeStyle = A(C.moss, idx ? 0.32 : 0.14);
    });
    // creek
    o.strokeStyle = A(C.moss, 0.45);
    o.lineWidth = 2;
    o.beginPath();
    smooth(
      o,
      [
        [0, 0.92],
        [0.14, 0.86],
        [0.28, 0.77],
        [0.42, 0.74],
        [0.52, 0.82],
        [0.66, 0.9],
        [0.82, 0.86],
        [1, 0.96],
      ].map(([x, y]) => [x * MW, y * MH] as [number, number]),
    );
    o.stroke();
    // trail
    o.strokeStyle = A(C.fog, 0.22);
    o.lineWidth = 1.5;
    o.setLineDash([2, 5]);
    o.lineCap = 'round';
    o.beginPath();
    smooth(
      o,
      [
        NODES[0],
        NODES[1],
        { x: 0.38, y: 0.58 },
        NODES[3],
        { x: 0.63, y: 0.48 },
        NODES[4],
        { x: 0.78, y: 0.27 },
        NODES[5],
      ].map(P),
    );
    o.stroke();
    o.setLineDash([]);
    monoFont(o, 10);
    o.textBaseline = 'middle';
    // elevation labels on index contours
    for (const [x, y] of [
      [0.68, 0.12],
      [0.6, 0.3],
      [0.3, 0.3],
      [0.83, 0.58],
      [0.45, 0.55],
    ]) {
      const s = String(Math.round((1500 + heightAt(x, y, MW / MH) * 1000) / 250) * 250);
      const w = o.measureText(s).width;
      o.fillStyle = C.night;
      o.fillRect(x * MW - 4, y * MH - 8, w + 8, 16);
      o.fillStyle = A(C.moss, 0.8);
      o.fillText(s, x * MW, y * MH);
    }
    o.fillStyle = A(C.moss, 0.7);
    for (let i = 0; i < 8; i++) o.fillText('ABCDEFGH'[i], (i * MW) / 8 + 7, MH - 40);
    for (let j = 1; j < 6; j++) o.fillText(String(j + 1), MW - 16, (j * MH) / 6 + 12);
  }

  /**
   * Alert `a` at `e` seconds after the call: blast rings and the sound wavefront (343 m/s), rings at
   * confirming nodes when the sound reaches them, the flood along the mesh to the base, and once it
   * arrives, the search area narrowing onto the loudness-weighted fix.
   */
  function drawAlert(c: CanvasRenderingContext2D, a: Alert, e: number, t: number, RM: boolean) {
    const [sx, sy] = P(NODES[a.src]);
    const cl = CLS[a.cls];
    for (const b of cl.bursts) {
      const age = e - b;
      if (age < 0 || age > 1.6) continue;
      const k = age / 1.6;
      c.strokeStyle = A(C.flare, (1 - k) * 0.9);
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(sx, sy, 12 + k * 80, 0, 7);
      c.stroke();
    }
    // the sound itself spreading at 343 m/s; nearby nodes hear it later and quieter
    const reach = Math.max(...a.heard.map((h) => h.delay)) + 0.4;
    if (e >= 0 && e < reach) {
      const m = e * 343;
      const k = e / reach;
      c.strokeStyle = A(C.flare, 0.22 * (1 - k));
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(sx, sy, (m / GROUND_W) * MW, (m / GROUND_H) * MH, 0, 0, 7);
      c.stroke();
    }
    for (const h of a.heard) {
      if (h.i === a.src) continue;
      const [hx, hy] = P(NODES[h.i]);
      const q = rel(a, h);
      for (const b of cl.bursts) {
        const age = e - b - h.delay;
        if (age < 0 || age > 1.3) continue;
        const k = age / 1.3;
        c.strokeStyle = A(C.flare, (1 - k) * (0.25 + 0.5 * q));
        c.lineWidth = 1;
        c.beginPath();
        c.arc(hx, hy, 9 + k * (20 + 50 * q), 0, 7);
        c.stroke();
      }
    }
    // the alert flooding hop by hop
    const { dist } = bfs(a.src);
    for (const [u, v] of LINKS)
      for (const [p, q] of [
        [u, v],
        [v, u],
      ]) {
        if (dist[q] !== dist[p] + 1) continue;
        const t0 = a.arrival[p];
        const t1 = a.arrival[q];
        if (e < t0 || e > t1) continue;
        const k = (e - t0) / (t1 - t0);
        const [x1, y1] = P(NODES[p]);
        const [x2, y2] = P(NODES[q]);
        const x = x1 + (x2 - x1) * k;
        const y = y1 + (y2 - y1) * k;
        c.strokeStyle = A(C.flare, 0.55);
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x, y);
        c.stroke();
        c.fillStyle = A(C.flare, 0.25);
        c.beginPath();
        c.arc(x, y, 8, 0, 7);
        c.fill();
        c.fillStyle = C.flare;
        c.beginPath();
        c.arc(x, y, 3.5, 0, 7);
        c.fill();
      }
    NODES.forEach((n, i) => {
      const age = e - a.arrival[i];
      if (age < 0 || age > 1.1 || i === a.src) return;
      const [x, y] = P(n);
      c.strokeStyle = A(C.fog, (1 - age / 1.1) * 0.6);
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, 8 + age * 26, 0, 7);
      c.stroke();
    });
    if (e < a.T) return;
    // confirmations narrow the search: the area starts wide and shrinks onto the fix
    const nk = RM ? 1 : Math.min(1, (e - a.T) / 1.4);
    const rM = a.est.r * (1 + 1.6 * Math.pow(1 - nk, 3));
    const ex = a.est.x * MW;
    const ey = a.est.y * MH;
    const rx = (rM / GROUND_W) * MW;
    const ry = (rM / GROUND_H) * MH;
    c.setLineDash([2, 4]);
    c.lineWidth = 1;
    for (const h of a.heard) {
      const [hx, hy] = P(NODES[h.i]);
      c.strokeStyle = A(C.flare, 0.15 + 0.4 * rel(a, h));
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo(ex, ey);
      c.stroke();
    }
    c.setLineDash([]);
    const pulse = RM ? 0 : (Math.sin(t * 2.4) + 1) / 2;
    c.fillStyle = A(C.flare, 0.08);
    c.beginPath();
    c.ellipse(ex, ey, rx, ry, 0, 0, 7);
    c.fill();
    c.strokeStyle = A(C.flare, 0.85);
    c.lineWidth = 1.5;
    c.setLineDash([4, 5]);
    c.lineDashOffset = RM ? 0 : -t * 8;
    c.beginPath();
    c.ellipse(ex, ey, rx, ry, 0, 0, 7);
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = A(C.flare, 0.35 * (1 - pulse));
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(ex, ey, rx + pulse * 16, ry + pulse * 16, 0, 0, 7);
    c.stroke();
    monoFont(c, 10);
    c.textBaseline = 'middle';
    const lbl = `${nk < 1 ? 'NARROWING' : 'SEARCH AREA'} · ~${Math.round(rM / 10) * 10} M`;
    const lw = c.measureText(lbl).width;
    c.fillStyle = A(C.night, 0.9);
    c.fillRect(ex - lw / 2 - 6, ey + ry + 6, lw + 12, 18);
    c.fillStyle = C.flare;
    c.fillText(lbl, ex - lw / 2, ey + ry + 15);
  }

  return {
    /** Matches the canvas to its CSS box and redraws the terrain. Returns false for a zero-size box. */
    resize(W: number, H: number) {
      if (!W || !H) return false;
      MW = W;
      MH = H;
      ctx = sizeCanvas(cv, MW, MH);
      renderStatic();
      return true;
    },

    draw(f: MapFrame) {
      const c = ctx;
      if (!c || !off) return;
      const RM = f.reducedMotion;
      c.clearRect(0, 0, MW, MH);
      c.drawImage(off, 0, 0, MW, MH);
      c.lineWidth = 1;
      c.strokeStyle = A(C.moss, 0.35);
      for (const [a, b] of LINKS) {
        const [x1, y1] = P(NODES[a]);
        const [x2, y2] = P(NODES[b]);
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
      }
      // route from the selected node to the base
      c.strokeStyle = A(C.fog, 0.8);
      c.lineWidth = 1.5;
      c.setLineDash([6, 6]);
      c.lineDashOffset = RM ? 0 : -f.t * 18;
      c.beginPath();
      pathToBase(f.sel).forEach((i, k) => {
        const [x, y] = P(NODES[i]);
        if (k) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.stroke();
      c.setLineDash([]);
      // heartbeats hopping to the base
      if (!RM) {
        if (f.t - lastSpawn > 1.5) {
          lastSpawn = f.t;
          const src = 1 + ((Math.random() * 5) | 0);
          hbs.push({ src, path: pathToBase(src), seg: 0, p: 0 });
        }
        for (const k of hbs) {
          k.p += f.dt * 1.5;
          if (k.p >= 1) {
            k.p = 0;
            k.seg++;
          }
        }
        hbs = hbs.filter((k) => {
          if (k.seg < k.path.length - 1) return true;
          onHeartbeat(k.src);
          return false;
        });
        c.fillStyle = A(C.fog, 0.85);
        for (const k of hbs) {
          const [x1, y1] = P(NODES[k.path[k.seg]]);
          const [x2, y2] = P(NODES[k.path[k.seg + 1]]);
          c.beginPath();
          c.arc(x1 + (x2 - x1) * k.p, y1 + (y2 - y1) * k.p, 2.2, 0, 7);
          c.fill();
        }
      }
      if (f.replay) drawAlert(c, f.replay.a, f.replay.e, f.t, RM);
      else if (f.live) drawAlert(c, f.live, f.t - f.live.start, f.t, RM);

      // which nodes have heard the call so far (replay time or live time)
      const view = f.replay ?? (f.live ? { a: f.live, e: f.t - f.live.start } : null);
      const heardNow = new Map<number, { q: number; peak: number; src: boolean }>();
      if (view)
        for (const h of view.a.heard)
          if (view.e >= h.delay)
            heardNow.set(h.i, { q: rel(view.a, h), peak: h.peak, src: h.i === view.a.src });

      monoFont(c, 10.5);
      c.textBaseline = 'middle';
      NODES.forEach((n, i) => {
        const [x, y] = P(n);
        if (n.kind === 'base') {
          c.save();
          c.translate(x, y);
          c.rotate(Math.PI / 4);
          c.fillStyle = C.fog;
          c.fillRect(-5.5, -5.5, 11, 11);
          c.restore();
          c.fillStyle = C.fog;
          c.fillText('BASE · RANGER STATION', x + 16, y);
          return;
        }
        const hv = heardNow.get(i);
        // quiet listening pulse
        if (!RM && !hv) {
          const k = (f.t * 0.35 + i * 0.21) % 1;
          c.strokeStyle = A(C.moss, (1 - k) * 0.28);
          c.lineWidth = 1;
          c.beginPath();
          c.arc(x, y, 6 + k * 22, 0, 7);
          c.stroke();
        }
        if (hv?.src) {
          // calling node: solid Flare
          c.strokeStyle = C.flare;
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, 13, 0, 7);
          c.stroke();
          c.fillStyle = C.flare;
          c.beginPath();
          c.arc(x, y, 6, 0, 7);
          c.fill();
        } else if (hv) {
          // confirming node: same signal, lighter; opacity follows how loud it heard the call
          const al = 0.3 + 0.5 * hv.q;
          c.fillStyle = A(C.flare, al * 0.22);
          c.beginPath();
          c.arc(x, y, 12, 0, 7);
          c.fill();
          c.strokeStyle = A(C.flare, al);
          c.lineWidth = 1.2;
          c.beginPath();
          c.arc(x, y, 11, 0, 7);
          c.stroke();
          c.fillStyle = A(C.flare, al);
          c.beginPath();
          c.arc(x, y, 5.5, 0, 7);
          c.fill();
        } else {
          c.fillStyle = i === f.sel ? C.fog : C.moss;
          c.beginPath();
          c.arc(x, y, 4.5, 0, 7);
          c.fill();
          if (n.batt < 20) {
            c.strokeStyle = C.moss;
            c.lineWidth = 1;
            c.setLineDash([2, 2]);
            c.beginPath();
            c.arc(x, y, 8, 0, 7);
            c.stroke();
            c.setLineDash([]);
          }
        }
        const label = `N${pad(n.num)} ${n.name.toUpperCase()}${n.batt < 20 ? ' · LOW' : ''}`;
        const lw = c.measureText(label).width;
        const lx = x + lw + 34 > MW ? x - lw - 22 : x + 18;
        c.fillStyle = A(C.night, 0.85);
        c.fillRect(lx - 5, y - 9, lw + 10, 18);
        c.fillStyle = hv || i === f.sel ? C.fog : C.moss;
        c.fillText(label, lx, y);
        if (hv) {
          const s = `${db(hv.peak)} DB · ${hv.src ? 'HEARD FIRST' : 'CONFIRMS'}`;
          const w = c.measureText(s).width;
          c.fillStyle = A(C.night, 0.9);
          c.fillRect(lx - 5, y - 28, w + 10, 17);
          c.fillStyle = hv.src ? C.flare : A(C.flare, 0.5 + 0.4 * hv.q);
          c.fillText(s, lx, y - 19.5);
        }
      });
      // selection ring
      const [sx, sy] = P(NODES[f.sel]);
      const k = RM ? 1 : Math.min(1, (f.t - f.selT) / 0.4);
      const ease = 1 - Math.pow(1 - k, 3);
      c.strokeStyle = A(C.fog, 0.9);
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(sx, sy, 30 - 10 * ease, 0, 7);
      c.stroke();
      c.strokeStyle = A(C.fog, 0.25);
      c.lineWidth = 1;
      c.beginPath();
      c.arc(sx, sy, 30, 0, 7);
      c.stroke();
    },

    /** The Serranode within 30 px of (x, y) in canvas pixels, or -1. */
    hit(x: number, y: number) {
      let best = -1;
      let bd = 30;
      NODES.forEach((n, i) => {
        if (n.kind === 'base') return;
        const d = Math.hypot(n.x * MW - x, n.y * MH - y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    },

    /** Width of 250 m on the map, in pixels, for the scale bar. */
    scale250: () => Math.round((250 / GROUND_W) * MW),
  };
}
