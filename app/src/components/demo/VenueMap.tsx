'use client';

// Floor plan of the venue triangle. Click the floor (or a taped mark below it) to simulate a call there;
// while connected to the live decoder, clicks do nothing: only real alerts appear, with no caller drawn.

import { useEffect, useRef } from 'react';
import { createVenueRenderer } from '@/lib/draw/venue';
import { now } from '@/lib/format';
import { useVenue } from '@/lib/venueStore';

export function VenueMap() {
  const boxRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ReturnType<typeof createVenueRenderer> | null>(null);
  const layout = useVenue((s) => s.layout);
  const simulateAt = useVenue((s) => s.simulateAt);
  const liveOn = useVenue((s) => s.liveOn);

  useEffect(() => {
    const box = boxRef.current!;
    const r = createVenueRenderer(cvRef.current!);
    rendererRef.current = r;
    const fit = () => {
      const b = box.getBoundingClientRect();
      r.resize(b.width, b.height, useVenue.getState().layout);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    void document.fonts?.ready.then(fit);
    // re-fit when the triangle size changes
    const unsub = useVenue.subscribe((s, prev) => {
      if (s.layout !== prev.layout) fit();
    });

    let raf = 0;
    const frame = () => {
      const s = useVenue.getState();
      r.draw({ t: now(), layout: s.layout, calls: s.calls, showTruth: s.showTruth });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
    };
  }, []);

  return (
    <section className="card venue-map-card" aria-labelledby="venue-h">
      <div className="card-head">
        <h3 id="venue-h">Venue floor</h3>
        <span className="label" id="venue-hint">
          {liveOn ? 'Listening for live calls' : 'Click the floor to simulate a call'}
        </span>
      </div>
      <div className="venue-map" id="venue-map" ref={boxRef}>
        <canvas
          ref={cvRef}
          aria-label="Floor plan of the three Serranodes. Click to simulate a call at that spot."
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            const p = rendererRef.current?.toFloor(
              e.clientX - b.left,
              e.clientY - b.top,
              useVenue.getState().layout,
            );
            if (p) simulateAt(p);
          }}
        />
      </div>
      <div className="venue-marks">
        <span className="label">Taped marks</span>
        {layout.marks.map((m) => (
          <button
            key={m.label}
            className="btn"
            data-mark={m.label}
            disabled={liveOn}
            onClick={() => simulateAt(m)}
          >
            {m.label} · {m.name}
          </button>
        ))}
      </div>
    </section>
  );
}
