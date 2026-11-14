'use client';

// Tactical map: canvas (lib/draw/map.ts) with HUD overlays. The canvas redraws every frame from the
// store via getState(), so React only re-renders the HUD when the map tag changes.

import { useEffect, useRef, useState } from 'react';
import { createMapRenderer } from '@/lib/draw/map';
import { now, prefersReducedMotion } from '@/lib/format';
import { currentAlert, incomingAlert, replayAlert, useDashboard } from '@/lib/store';

function MapTag() {
  const replayE = useDashboard((s) => s.replay?.e ?? null);
  const incoming = useDashboard((s) => !!incomingAlert(s.alerts));
  const [cls, text] =
    replayE !== null
      ? ['replay', `Replay · t+${replayE.toFixed(1)} s`]
      : incoming
        ? ['incoming', 'Incoming · relaying']
        : ['', 'Live · listening'];
  return (
    <span className={`map-tag ${cls}`.trim()} id="map-tag">
      <i />
      <span>{text}</span>
    </span>
  );
}

export function MapView() {
  const boxRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ReturnType<typeof createMapRenderer> | null>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const box = boxRef.current!;
    const r = createMapRenderer(cvRef.current!, (src) => useDashboard.getState().heartbeat(src));
    rendererRef.current = r;
    const RM = prefersReducedMotion();

    const fit = () => {
      const b = box.getBoundingClientRect();
      if (r.resize(b.width, b.height)) setScale(r.scale250());
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    // canvas text uses the bundled fonts; redraw the terrain labels once they've loaded
    void document.fonts?.ready.then(fit);

    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      const dt = Math.min(0.05, ts / 1000 - (last || ts / 1000));
      last = ts / 1000;
      const s = useDashboard.getState();
      const ra = replayAlert(s);
      r.draw({
        t: now(),
        dt,
        sel: s.sel,
        selT: s.selT,
        live: currentAlert(s.alerts) ?? null,
        replay: ra && s.replay ? { a: ra, e: s.replay.e } : null,
        reducedMotion: RM,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const pointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return rendererRef.current?.hit(e.clientX - b.left, e.clientY - b.top) ?? -1;
  };

  return (
    <div className="map" id="map" ref={boxRef}>
      <canvas
        id="map-canvas"
        ref={cvRef}
        aria-label="Map of Serranode positions. Click a node to select it."
        onClick={(e) => {
          const i = pointer(e);
          if (i > 0) useDashboard.getState().select(i);
        }}
        onMouseMove={(e) => {
          e.currentTarget.style.cursor = pointer(e) > 0 ? 'pointer' : 'crosshair';
        }}
      />
      <div className="hud tl">
        <span className="label">Sector</span>
        <strong>Hollow Pine Wilderness</strong>
      </div>
      <div className="hud tr">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <circle cx="20" cy="20" r="18.5" stroke="var(--line-2)" />
          <path d="M20 7l4 13h-8z" fill="var(--fog)" />
          <path d="M20 33l-4-13h8z" fill="var(--stone)" />
        </svg>
        <MapTag />
      </div>
      <div className="hud bl">
        <span>
          <i className="sw node" />
          Serranode
        </span>
        <span>
          <i className="sw call" />
          Heard first
        </span>
        <span>
          <i className="sw conf" />
          Confirming
        </span>
        <span>
          <i className="sw sel" />
          Selected
        </span>
        <span>
          <i className="sw base" />
          Base
        </span>
        <span>
          <i className="sw link" />
          Serranet link
        </span>
        <span>
          <i className="sw route" />
          Route to base
        </span>
        <span>
          <i className="sw area" />
          Search area
        </span>
      </div>
      <div className="hud br">
        <div className="scalebar" id="scalebar" style={scale ? { width: scale } : undefined}>
          <i />
          <i />
          <i />
          <i />
        </div>
        <span>250 m · contour 50 m</span>
      </div>
    </div>
  );
}
