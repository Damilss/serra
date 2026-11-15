// Venue floor-plan renderer (canvas) for the /demo page.
//
// Detect-only demo. Per call, the timeline is: the sound spreads from the caller (simulated calls
// only, slowed down so it can be followed), each node lights up as the sound reaches it (brighter =
// louder), shows what its own classifier made of it, then sends its alert over the mesh as packet
// dots: straight to the base station, and from the loudest node to the other nodes, which flash and
// relay it on. Nothing is located: there is no estimate on the floor.

import { A, C, monoFont, sizeCanvas } from '../brand';
import type { MapPoint } from '../types';
import { FT, dist, type VenueLayout } from '../venue';
import type { VenueCall } from '../venueStore';

/** On-screen speed of sound, m/s: real sound would cross the triangle in 18 ms. */
const SHOWN_SPEED = 8;
/** How long a node takes to classify the sound on screen, s (the real model takes ~70 ms). */
const CLASSIFY = 0.6;
/** On-screen speed of the radio flood, m/s. */
const RADIO_SPEED = 7;
/** How long the finished call stays animated after the last alert reaches the base, s. */
const HOLD = 1.2;
/** How long a node holds an alert it received before relaying it, s. */
const RELAY_PAUSE = 0.15;
/** How long a node's ring flashes when a relayed alert reaches it, s. */
const FLASH = 0.5;

/**
 * One alert travelling over one radio link, as a packet dot on the map.
 * own: a node sends its own alert to the base. relay: the loudest node's alert reaches another node.
 * forward: that node passes the copy on to the base (a duplicate the base station drops).
 */
export interface Leg {
  from: MapPoint;
  to: MapPoint;
  start: number;
  dur: number;
  kind: 'own' | 'relay' | 'forward';
}

export interface VenueFrame {
  t: number;
  layout: VenueLayout;
  calls: VenueCall[];
  showTruth: boolean;
}

/** When each stage of a call happens, in seconds after the call. Infinity: never (node didn't report). */
export function callTimeline(layout: VenueLayout, call: VenueCall) {
  // live calls have no known source: every reporting node hears it at once
  const src = call.truth;
  const reporting = layout.nodes.map((_, i) => call.levels[i] !== null);
  const heardAt = layout.nodes.map((n, i) =>
    !reporting[i] ? Infinity : src ? dist(n, src) / SHOWN_SPEED : 0,
  );
  const classifiedAt = heardAt.map((h) => h + CLASSIFY);
  const reachedAt = layout.nodes.map((n, i) => classifiedAt[i] + dist(n, layout.base) / RADIO_SPEED);
  const finite = (xs: number[]) => xs.filter(Number.isFinite);
  const first = (xs: number[]) => (finite(xs).length ? Math.min(...finite(xs)) : Infinity);
  const last = (xs: number[]) => (finite(xs).length ? Math.max(...finite(xs)) : Infinity);
  const leg = (from: MapPoint, to: MapPoint, start: number, kind: Leg['kind']): Leg => ({
    from,
    to,
    start,
    dur: dist(from, to) / RADIO_SPEED,
    kind,
  });

  // Each reporting node sends its own alert to the base: directly, or (when the decoder says it took
  // a hop) through the node nearest the base. The loudest node's alert also floods to the other
  // nodes, which relay it on to the base: the copies the base station drops as duplicates.
  const legs: Leg[] = [];
  const nearBase = (except: number) =>
    layout.nodes.reduce(
      (best, n, k) =>
        k !== except && (best < 0 || dist(n, layout.base) < dist(layout.nodes[best], layout.base)) ? k : best,
      -1,
    );
  layout.nodes.forEach((n, i) => {
    if (!reporting[i]) return;
    const via = (call.hops[i] ?? 0) > 0 ? nearBase(i) : -1;
    if (via < 0) {
      legs.push(leg(n, layout.base, classifiedAt[i], 'own'));
    } else {
      const hop = leg(n, layout.nodes[via], classifiedAt[i], 'own');
      const last = leg(layout.nodes[via], layout.base, hop.start + hop.dur + RELAY_PAUSE, 'own');
      legs.push(hop, last);
      reachedAt[i] = last.start + last.dur;
    }
  });
  const lv = call.levels.map((l) => l ?? -Infinity);
  const loudest = lv.indexOf(Math.max(...lv));
  if (loudest >= 0 && reporting[loudest]) {
    const from = layout.nodes[loudest];
    layout.nodes.forEach((n, j) => {
      if (j === loudest) return;
      const r = leg(from, n, classifiedAt[loudest], 'relay');
      legs.push(r, leg(n, layout.base, r.start + r.dur + RELAY_PAUSE, 'forward'));
    });
  }
  const legsEnd = last(legs.map((l) => l.start + l.dur));

  return {
    heardAt,
    classifiedAt,
    reachedAt,
    legs,
    firstHeardAt: first(heardAt),
    firstClassifiedAt: first(classifiedAt),
    /** The first copy of the alert reaches the base station. */
    receivedAt: first(reachedAt),
    doneAt: Math.max(last(reachedAt), legsEnd) + HOLD,
  };
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

      const call = f.calls[0];
      const e = call ? f.t - call.t0 : -1;
      const tl = call ? callTimeline(layout, call) : null;
      const levels = call ? call.levels : [];
      const heardLv = levels.filter((l): l is number => l !== null);
      const loudest = heardLv.length ? levels.indexOf(Math.max(...heardLv)) : -1;
      const quietest = heardLv.length ? Math.min(...heardLv) : 0;
      const received = !!tl && e >= tl.receivedAt;

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
      monoFont(c, 10);
      c.textBaseline = 'middle';
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

      // the sound spreading from the caller (simulated calls only: live calls have no known source)
      const soundEnd = tl ? Math.max(...tl.heardAt.filter(Number.isFinite), 0) + 0.3 : 0;
      if (call?.truth && tl && e >= 0 && e < soundEnd) {
        const [x, y] = P(call.truth);
        for (const lag of [0, 0.18, 0.36]) {
          const r = Math.max(0, e - lag) * SHOWN_SPEED * S;
          if (r <= 0) continue;
          c.strokeStyle = A(C.flare, 0.5 * (1 - e / soundEnd));
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, r, 0, 7);
          c.stroke();
        }
      }

      // the mesh: radio links between the nodes, and from each node to the base station
      c.setLineDash([2, 6]);
      c.lineWidth = 1;
      c.strokeStyle = A(C.moss, 0.28);
      layout.nodes.forEach((n, i) => {
        const [x, y] = P(n);
        for (const m of [...layout.nodes.slice(i + 1), layout.base]) {
          const [mx, my] = P(m);
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(mx, my);
          c.stroke();
        }
      });
      c.setLineDash([]);

      // the alert flooding the mesh: a packet dot per radio hop, and a flash where a node relays it
      if (call && tl) {
        for (const l of tl.legs) {
          const p = (e - l.start) / l.dur;
          const [x0, y0] = P(l.from);
          const [x1, y1] = P(l.to);
          if (p >= 0 && p <= 1) {
            const tail = Math.max(0, p - 0.18);
            const dim = l.kind === 'forward' ? 0.5 : 0.95;
            c.strokeStyle = A(C.fog, dim * 0.6);
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(x0 + (x1 - x0) * tail, y0 + (y1 - y0) * tail);
            c.lineTo(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p);
            c.stroke();
            c.fillStyle = A(C.fog, dim);
            c.beginPath();
            c.arc(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p, l.kind === 'forward' ? 2.5 : 3.5, 0, 7);
            c.fill();
          }
          const since = e - l.start - l.dur;
          if (l.kind === 'relay' && since >= 0 && since < FLASH) {
            const k = since / FLASH;
            c.strokeStyle = A(C.fog, 0.8 * (1 - k));
            c.lineWidth = 1.5;
            c.beginPath();
            c.arc(x1, y1, 10 + 14 * k, 0, 7);
            c.stroke();
          }
        }
      }

      // base station: lights up when the first copy of the alert arrives
      monoFont(c, 10);
      const [bx, by] = P(layout.base);
      if (received && tl) {
        const k = Math.min(1, (e - tl.receivedAt) / 1.2);
        c.strokeStyle = A(C.fog, 0.8 * (1 - k));
        c.lineWidth = 2;
        c.beginPath();
        c.arc(bx, by, 10 + 22 * k, 0, 7);
        c.stroke();
      }
      c.save();
      c.translate(bx, by);
      c.rotate(Math.PI / 4);
      c.fillStyle = C.fog;
      const half = received ? 7 : 5;
      c.fillRect(-half, -half, half * 2, half * 2);
      c.restore();
      const baseLabel = received ? 'BASE STATION · RECEIVED' : 'BASE STATION';
      c.fillStyle = C.fog;
      c.fillText(baseLabel, bx - c.measureText(baseLabel).width - 14, by);

      // nodes: listening, then heard (brighter = louder), then classified
      monoFont(c, 10.5);
      layout.nodes.forEach((n, i) => {
        const [x, y] = P(n);
        const lv = levels[i] ?? null;
        const missed = !!call && lv === null;
        const heard = !!call && lv !== null && !!tl && e >= tl.heardAt[i];
        const classified = heard && !!tl && e >= tl.classifiedAt[i];
        const top = loudest >= 0 ? (levels[loudest] ?? 0) : 0;
        const q = lv !== null && top > quietest ? (lv - quietest) / (top - quietest) : 1;
        if (heard && i === loudest) {
          c.strokeStyle = C.flare;
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, 14, 0, 7);
          c.stroke();
          c.fillStyle = C.flare;
        } else if (heard) {
          c.fillStyle = A(C.flare, 0.5 + 0.35 * q);
        } else if (missed) {
          c.fillStyle = A(C.moss, 0.45);
        } else {
          const k = (f.t * 0.35 + i * 0.27) % 1;
          c.strokeStyle = A(C.moss, (1 - k) * 0.3);
          c.lineWidth = 1;
          c.beginPath();
          c.arc(x, y, 7 + k * 20, 0, 7);
          c.stroke();
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
        if (classified && call) {
          const cls = (call.classes[i] ?? call.cls).toUpperCase();
          const conf = call.confidence[i];
          c.fillStyle = i === loudest ? C.flare : A(C.flare, 0.8 + 0.2 * q);
          c.fillText(conf === null ? cls : `${cls} · ${Math.round(conf * 100)}%`, lx, y + 8);
        } else if (heard && lv !== null) {
          c.fillStyle = A(C.flare, 0.8 + 0.2 * q);
          c.fillText(`HEARD · ${lv.toFixed(1)} DB`, lx, y + 8);
        } else if (missed) {
          c.fillStyle = C.stone;
          c.fillText('DID NOT REPORT', lx, y + 8);
        } else {
          c.fillStyle = C.moss;
          c.fillText('LISTENING', lx, y + 8);
        }
        c.textAlign = 'left';
      });

      // where the simulated caller stood (rehearsal)
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
