'use client';

// Bar waveform of the selected node's last audio capture, with the wake trigger line. The bars of the
// most recent call it heard rise above the line, taller the louder it heard it.

import { useEffect, useRef } from 'react';
import { CLS, rel } from '@/lib/alerts';
import { A, C, monoFont, sizeCanvas } from '@/lib/brand';
import { db, hms, mulberry } from '@/lib/format';
import { CALL_DB, TRIGGER_DB } from '@/lib/sound';
import { useDashboard } from '@/lib/store';
import type { Alert } from '@/lib/types';

function draw(cv: HTMLCanvasElement, sel: number, a: Alert | undefined) {
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const c = sizeCanvas(cv, r.width, r.height);
  const W = r.width;
  const H = r.height;
  const mid = H / 2;
  const h = a?.heard.find((x) => x.i === sel);
  const ratio = h ? Math.max(0, Math.min(1, (h.peak / 10 - TRIGGER_DB) / (CALL_DB.whistle - TRIGGER_DB))) : 0;
  const rnd = mulberry(sel * 101 + (a ? a.id : 0));
  const NB = 96;
  const bw = W / NB;
  const thr = 0.34;
  c.setLineDash([2, 4]);
  c.strokeStyle = A(C.moss, 0.45);
  c.lineWidth = 1;
  for (const y of [mid - (thr * (H - 12)) / 2, mid + (thr * (H - 12)) / 2]) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(W, y);
    c.stroke();
  }
  c.setLineDash([]);
  const shape = a ? CLS[a.cls].shape : [];
  for (let i = 0; i < NB; i++) {
    const x = i / NB;
    let v = 0.05 + rnd() * 0.09 + (rnd() < 0.05 ? rnd() * 0.12 : 0);
    let hot = false;
    for (const [b0, bwid] of shape) {
      if (x >= b0 && x < b0 + bwid) {
        const env = Math.sin(((x - b0) / bwid) * Math.PI) ** 0.35;
        v = Math.max(v, (0.45 + 0.5 * ratio) * env * (0.86 + rnd() * 0.14));
        hot = true;
      }
    }
    const hh = v * (H - 12);
    c.fillStyle =
      hot && a && h ? (a.src === sel ? C.flare : A(C.flare, 0.45 + 0.45 * rel(a, h))) : A(C.moss, 0.7);
    const bx = i * bw + bw * 0.2;
    const ww = Math.max(1.5, bw * 0.6);
    c.beginPath();
    c.roundRect(bx, mid - hh / 2, ww, hh, ww / 2);
    c.fill();
  }
  monoFont(c, 9);
  c.textBaseline = 'top';
  c.fillStyle = A(C.moss, 0.9);
  c.fillText('WAKE TRIGGER', 6, 4);
}

export function Waveform() {
  const ref = useRef<HTMLCanvasElement>(null);
  const sel = useDashboard((s) => s.sel);
  // the most recent landed alert this node heard
  const a = useDashboard((s) =>
    s.alerts.find((x) => x.status !== 'incoming' && x.heard.some((h) => h.i === s.sel)),
  );

  useEffect(() => {
    const cv = ref.current!;
    const redraw = () => draw(cv, sel, a);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(cv);
    void document.fonts?.ready.then(redraw);
    return () => ro.disconnect();
  }, [sel, a]);

  const h = a?.heard.find((x) => x.i === sel);
  return (
    <div className="wave">
      <div className="row">
        <span className="label">Last audio capture</span>
        <span id="wave-cap">
          {a && h ? `${hms(a.wall)} / ${CLS[a.cls].word} / ${db(h.peak)} dB` : 'Ambient · below trigger'}
        </span>
      </div>
      <canvas id="wave" ref={ref} aria-label="Audio envelope of the Serranode's last capture" />
    </div>
  );
}
