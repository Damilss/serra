// Venue floor-plan renderer (canvas) for the /demo page.
//
// Per call, the timeline is: the sound spreads from the caller (slowed down so it can be followed),
// each node lights up as the sound reaches it (brighter = louder), the readings relay to the base,
// then the estimate appears and its uncertainty circle narrows to the final fit.

import { A, C, monoFont, sizeCanvas } from '../brand';
import type { MapPoint } from '../types';
import { FT, dist, toFt, type VenueLayout } from '../venue';
import type { VenueCall } from '../venueStore';

/** On-screen speed of sound, m/s: real sound would cross the triangle in 18 ms. */
const SHOWN_SPEED = 8;
/** Pause for the mesh relay to the base, s. */
const RELAY = 0.5;
/** How long the uncertainty circle takes to narrow, s. */
const NARROW = 0.9;

export interface VenueFrame {
  t: number;
  layout: VenueLayout;
  calls: VenueCall[];
  showTruth: boolean;
  reducedMotion: boolean;
}

/** When each stage of a call happens, in seconds after the call. */
export function callTimeline(layout: VenueLayout, call: VenueCall) {
  const src = call.truth ?? call.fix;
  const heardAt = layout.nodes.map((n) => dist(n, src) / SHOWN_SPEED);
  const allHeard = Math.max(...heardAt);
  return { heardAt, fixAt: allHeard + RELAY, doneAt: allHeard + RELAY + NARROW };
}

export function createVenueRenderer(cv: HTMLCanvasElement) {
  let ctx: CanvasRenderingContext2D | null = null;
  let CW = 0;
  let CH = 0;
  let S = 1; // px per metre
  let OX = 0;
  let OY = 0;

  const P = (p: MapPoint): [number, number] => [OX + p.x * S, OY + p.y * S];

  return {
    resize(width: number, height: number, layout: VenueLayout) {
      if (!width || !height) return false;
      CW = width;
      CH = height;
      ctx = sizeCanvas(cv, CW, CH);
      S = Math.min((CW - 24) / layout.width, (CH - 24) / layout.height);
      OX = (CW - layout.width * S) / 2;
      OY = (CH - layout.height * S) / 2;
      return true;
    },

    /** Canvas pixel → floor metres, or null outside the floor. */
    toFloor(x: number, y: number, layout: VenueLayout): MapPoint | null {
      const p = { x: (x - OX) / S, y: (y - OY) / S };
      return p.x >= 0 && p.y >= 0 && p.x <= layout.width && p.y <= layout.height ? p : null;
    },

    draw(f: VenueFrame) {
      const c = ctx;
      if (!c) return;
      const { layout } = f;
      c.clearRect(0, 0, CW, CH);
      c.fillStyle = C.night;
      c.fillRect(0, 0, CW, CH);

      // floor and a 5 ft grid
      const [fx, fy] = P({ x: 0, y: 0 });
      c.strokeStyle = A(C.moss, 0.08);
      c.lineWidth = 1;
      for (let x = 0; x <= layout.width; x += 5 * FT) {
        const px = Math.round(fx + x * S) + 0.5;
        c.beginPath();
        c.moveTo(px, fy);
        c.lineTo(px, fy + layout.height * S);
        c.stroke();
      }
      for (let y = 0; y <= layout.height; y += 5 * FT) {
        const py = Math.round(fy + y * S) + 0.5;
        c.beginPath();
        c.moveTo(fx, py);
        c.lineTo(fx + layout.width * S, py);
        c.stroke();
      }
      c.strokeStyle = A(C.moss, 0.3);
      c.lineWidth = 1.5;
      c.strokeRect(fx, fy, layout.width * S, layout.height * S);

      // base station
      monoFont(c, 10);
      c.textBaseline = 'middle';
      const [bx, by] = P(layout.base);
      c.save();
      c.translate(bx, by);
      c.rotate(Math.PI / 4);
      c.fillStyle = C.fog;
      c.fillRect(-5, -5, 10, 10);
      c.restore();
      const baseLabel = 'BASE';
      c.fillStyle = C.fog;
      c.fillText(baseLabel, bx - c.measureText(baseLabel).width - 14, by);

      // the taped triangle
      c.setLineDash([6, 6]);
      c.strokeStyle = A(C.moss, 0.5);
      c.lineWidth = 1.5;
      c.beginPath();
      layout.nodes.forEach((n, i) => {
        const [x, y] = P(n);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      });
      c.closePath();
      c.stroke();
      c.setLineDash([]);
      const [ax, ay] = P(layout.nodes[0]);
      const [bbx] = P(layout.nodes[1]);
      const side = `${layout.sideFt} FT`;
      c.fillStyle = C.moss;
      c.fillText(side, (ax + bbx) / 2 - c.measureText(side).width / 2, ay + 22);

      // taped marks
      for (const m of layout.marks) {
        const [x, y] = P(m);
        c.strokeStyle = C.stone;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(x - 5, y - 5);
        c.lineTo(x + 5, y + 5);
        c.moveTo(x + 5, y - 5);
        c.lineTo(x - 5, y + 5);
        c.stroke();
        c.fillStyle = C.stone;
        c.fillText(m.label, x + 9, y + 10);
      }

      // earlier fixes, faint
      for (const old of f.calls.slice(1, 6)) {
        const [x, y] = P(old.fix);
        c.fillStyle = A(C.flare, 0.25);
        c.beginPath();
        c.arc(x, y, 3, 0, 7);
        c.fill();
      }

      const call = f.calls[0];
      const e = call ? (f.reducedMotion ? 1e3 : f.t - call.t0) : -1;
      const tl = call ? callTimeline(layout, call) : null;
      const levels = call ? call.readings.map((r) => r.peak / 10) : [];
      const loudest = levels.length ? levels.indexOf(Math.max(...levels)) : -1;
      const quietest = levels.length ? Math.min(...levels) : 0;

      // the sound spreading from the caller (simulated calls only: live calls have no known source)
      if (call?.truth && tl && e >= 0 && e < tl.fixAt) {
        const [x, y] = P(call.truth);
        for (const lag of [0, 0.18, 0.36]) {
          const r = Math.max(0, e - lag) * SHOWN_SPEED * S;
          if (r <= 0) continue;
          c.strokeStyle = A(C.flare, 0.5 * (1 - e / tl.fixAt));
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, r, 0, 7);
          c.stroke();
        }
      }

      // the fix: lines from each node, the narrowing circle, the estimate
      if (call && tl && e >= tl.fixAt) {
        const k = Math.min(1, (e - tl.fixAt) / NARROW);
        const r = call.fix.r * (1 + 2.2 * Math.pow(1 - k, 3)) * S;
        const [ex, ey] = P(call.fix);
        c.setLineDash([2, 4]);
        c.lineWidth = 1;
        layout.nodes.forEach((n, i) => {
          const [x, y] = P(n);
          c.strokeStyle = A(C.flare, i === loudest ? 0.6 : 0.3);
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(ex, ey);
          c.stroke();
        });
        c.setLineDash([]);
        c.fillStyle = A(C.flare, 0.1);
        c.beginPath();
        c.arc(ex, ey, r, 0, 7);
        c.fill();
        c.setLineDash([4, 5]);
        c.lineDashOffset = f.reducedMotion ? 0 : -f.t * 8;
        c.strokeStyle = A(C.flare, 0.9);
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(ex, ey, r, 0, 7);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = C.flare;
        c.beginPath();
        c.arc(ex, ey, 4.5, 0, 7);
        c.fill();
        // the other spot that fits the readings about as well (three nodes can't tell them apart)
        if (call.fix.alt) {
          const [qx, qy] = P(call.fix.alt);
          c.setLineDash([3, 5]);
          c.strokeStyle = A(C.flare, 0.55);
          c.lineWidth = 1.2;
          c.beginPath();
          c.arc(qx, qy, call.fix.r * S, 0, 7);
          c.stroke();
          c.setLineDash([]);
          c.fillStyle = A(C.flare, 0.7);
          const q = 'OR HERE?';
          const qw = c.measureText(q).width;
          c.fillText(
            q,
            Math.min(CW - qw - 4, Math.max(4, qx - qw / 2)),
            Math.max(12, qy - call.fix.r * S - 10),
          );
        }
        const lbl = `${k < 1 ? 'NARROWING' : 'ESTIMATE'} · ±${toFt(call.fix.r).toFixed(1)} FT`;
        const lw = c.measureText(lbl).width;
        c.fillStyle = A(C.night, 0.9);
        c.fillRect(ex - lw / 2 - 6, ey + r + 6, lw + 12, 18);
        c.fillStyle = C.flare;
        c.fillText(lbl, ex - lw / 2, ey + r + 15);
      }

      // nodes, lit once the sound reaches them
      monoFont(c, 10.5);
      layout.nodes.forEach((n, i) => {
        const [x, y] = P(n);
        const heard = call && tl && e >= tl.heardAt[i];
        const q =
          levels.length && levels[loudest] > quietest
            ? (levels[i] - quietest) / (levels[loudest] - quietest)
            : 1;
        if (heard && i === loudest) {
          c.strokeStyle = C.flare;
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, 14, 0, 7);
          c.stroke();
          c.fillStyle = C.flare;
        } else if (heard) {
          c.fillStyle = A(C.flare, 0.5 + 0.35 * q);
        } else {
          if (!f.reducedMotion) {
            const k = (f.t * 0.35 + i * 0.27) % 1;
            c.strokeStyle = A(C.moss, (1 - k) * 0.3);
            c.lineWidth = 1;
            c.beginPath();
            c.arc(x, y, 7 + k * 20, 0, 7);
            c.stroke();
          }
          c.fillStyle = C.moss;
        }
        c.beginPath();
        c.arc(x, y, 7, 0, 7);
        c.fill();
        const right = x + 160 < CW;
        const lx = right ? x + 20 : x - 20;
        c.textAlign = right ? 'left' : 'right';
        c.fillStyle = C.fog;
        c.fillText(`NODE ${n.label}`, lx, y - 7);
        if (heard) {
          c.fillStyle = i === loudest ? C.flare : A(C.flare, 0.8 + 0.2 * q);
          c.fillText(`${levels[i].toFixed(1)} DB · ${i === loudest ? 'LOUDEST' : 'CONFIRMS'}`, lx, y + 8);
        } else {
          c.fillStyle = C.moss;
          c.fillText('LISTENING', lx, y + 8);
        }
        c.textAlign = 'left';
      });

      // where the caller really was (rehearsal)
      if (call?.truth && f.showTruth) {
        const [x, y] = P(call.truth);
        c.strokeStyle = C.fog;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(x, y, 6, 0, 7);
        c.stroke();
        c.fillStyle = C.fog;
        c.font = c.font.replace(/\d+(\.\d+)?px/, '10px');
        const s = 'CALLER';
        c.fillText(s, x - c.measureText(s).width / 2, y - 14);
      }
    },
  };
}
