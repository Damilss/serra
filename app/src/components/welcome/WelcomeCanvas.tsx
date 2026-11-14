'use client';

// Welcome background: slowly drifting topo lines, a few listening nodes, and one node calling
// (the single Flare on the page) with rings carrying outward.

import { useEffect, useRef } from 'react';
import { A, C, monoFont, sizeCanvas } from '@/lib/brand';
import { prefersReducedMotion } from '@/lib/format';
import { contours, type Peak } from '@/lib/terrain';

const WPEAKS: Peak[] = [
  { x: 0.78, y: 0.36, r: 0.26, a: 1.0, dx: 0.015, dy: 0.01, s: 0.08, ph: 0 },
  { x: 0.12, y: 0.86, r: 0.2, a: 0.8, dx: 0.012, dy: 0.01, s: 0.07, ph: 2 },
  { x: 0.42, y: 0.1, r: 0.12, a: 0.25, dx: 0.02, dy: 0.01, s: 0.05, ph: 4 },
];
const WNODES = [
  { l: 'N01', x: 0.64, y: 0.14 },
  { l: 'N02', x: 0.91, y: 0.3 },
  { l: 'N03', x: 0.88, y: 0.8, hot: true },
  { l: 'N04', x: 0.07, y: 0.93 },
  { l: 'N05', x: 0.56, y: 0.9 },
];
const LABELS: [number, number, string][] = [
  [0.72, 0.2, '2100'],
  [0.75, 0.27, '2400'],
  [0.33, 0.95, '1500'],
];
const LEVELS = Array.from({ length: 9 }, (_, i) => 0.08 + i * 0.11);

export function WelcomeCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const RM = prefersReducedMotion();
    let W = 0;
    let H = 0;
    let c: CanvasRenderingContext2D;
    let raf = 0;
    let ripples: number[] = [];
    let lastRipple = -10;

    const size = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      c = sizeCanvas(cv, W, H);
    };

    const draw = (ts: number) => {
      const t = ts / 1000;
      c.fillStyle = C.night;
      c.fillRect(0, 0, W, H);
      c.strokeStyle = A(C.moss, 0.07);
      c.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const x = Math.round((i * W) / 5) + 0.5;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, H);
        c.stroke();
      }
      for (let j = 1; j < 4; j++) {
        const y = Math.round((j * H) / 4) + 0.5;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(W, y);
        c.stroke();
      }
      contours(c, W, H, 14, RM ? 0 : t, WPEAKS, LEVELS, (cx, k) => {
        cx.lineWidth = k % 3 === 1 ? 1.4 : 1;
        cx.strokeStyle = A(C.moss, k % 3 === 1 ? 0.3 : 0.16);
      });
      monoFont(c, 11);
      c.textBaseline = 'middle';
      for (const [x, y, s] of LABELS) {
        c.fillStyle = A(C.night, 0.9);
        const w = c.measureText(s).width;
        c.fillRect(x * W - 4, y * H - 8, w + 8, 16);
        c.fillStyle = C.moss;
        c.fillText(s, x * W, y * H);
      }
      // the one Flare: a node making a call, three rings carrying outward
      if (!RM && t - lastRipple > 3.6) {
        lastRipple = t;
        ripples.push(t, t + 0.45, t + 0.9);
      }
      ripples = ripples.filter((r) => t - r < 2.6);
      for (const n of WNODES) {
        const x = n.x * W;
        const y = n.y * H;
        if (n.hot) {
          for (const r0 of ripples) {
            const age = t - r0;
            if (age < 0) continue;
            const k = age / 2.6;
            c.strokeStyle = A(C.flare, (1 - k) * 0.7);
            c.lineWidth = 1.5;
            c.beginPath();
            c.arc(x, y, 14 + k * 120, 0, 7);
            c.stroke();
          }
          c.strokeStyle = C.flare;
          c.lineWidth = 1.5;
          c.beginPath();
          c.arc(x, y, 15, 0, 7);
          c.stroke();
          c.fillStyle = C.flare;
          c.beginPath();
          c.arc(x, y, 6, 0, 7);
          c.fill();
          c.fillStyle = C.moss;
          c.fillText(n.l, x + 22, y);
        } else {
          c.fillStyle = A(C.moss, 0.9);
          c.beginPath();
          c.arc(x, y, 4.5, 0, 7);
          c.fill();
          c.fillStyle = C.moss;
          c.fillText(n.l, x + 13, y);
        }
      }
      if (!RM) raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      size();
      if (RM) draw(0);
    };
    size();
    if (RM) draw(0);
    else raf = requestAnimationFrame(draw);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas id="welcome-bg" ref={ref} aria-hidden="true" />;
}
