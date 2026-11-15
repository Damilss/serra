'use client';

// Dashboard shell. Ops mode (desktop): top bar, stat tiles, alert card, node picker, then the map,
// replay, feed and packets beside the Serranode panel. Rescuer mode (phone): one daylight card.
//
// Owns the app-wide loops: the per-frame loop that lands relayed alerts and advances replays, the
// one-second clock, and the keyboard shortcuts.

import { useEffect } from 'react';
import { CALL_DB, TRIGGER_DB, levelAt } from '@/lib/sound';
import { lat, lon, NODES } from '@/lib/geo';
import { makeAlert, summary } from '@/lib/alerts';
import { buildPacket } from '@/lib/packets';
import { useDashboard } from '@/lib/store';
import { AlertCard } from './AlertCard';
import { Feed } from './Feed';
import { MapView } from './MapView';
import { NodePanel } from './NodePanel';
import { PacketView } from './PacketView';
import { Picker } from './Picker';
import { ReplayBar } from './ReplayBar';
import { Rescuer } from './Rescuer';
import { Stats } from './Stats';
import { TopBar } from './TopBar';

// Phone-width screens open in rescuer mode, decided once per page load.
let modeChosen = false;

export function Dashboard() {
  const mode = useDashboard((s) => s.mode);

  useEffect(() => {
    const s = useDashboard.getState();
    if (!modeChosen) {
      modeChosen = true;
      if (window.innerWidth < 640) s.setMode('rescuer');
    }

    // per frame: land relayed alerts at the base, advance a playing replay
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      const t = ts / 1000;
      const dt = Math.min(0.05, t - (last || t));
      last = t;
      const st = useDashboard.getState();
      st.promoteArrivals();
      st.advanceReplay(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const second = setInterval(() => useDashboard.getState().tickSecond(), 1000);

    const onKey = (e: KeyboardEvent) => {
      const st = useDashboard.getState();
      const target = e.target as HTMLElement | null;
      if (st.mode !== 'ops' || target?.closest('select, input, textarea')) return;
      if (e.key === 'ArrowLeft') st.step(-1);
      else if (e.key === 'ArrowRight') st.step(1);
      else if (e.key === 'w' || e.key === 'W') st.simulate(st.sel);
    };
    window.addEventListener('keydown', onKey);

    // Read-only handle for the Playwright tests and the browser console. Not part of the data flow.
    Object.defineProperty(window, 'serraMock', {
      configurable: true,
      value: Object.freeze({
        NODES,
        get alerts() {
          return useDashboard.getState().alerts;
        },
        get packets() {
          return useDashboard.getState().packets;
        },
        makeAlert,
        summary,
        lat,
        lon,
        TRIGGER_DB,
        CALL_DB,
        levelAt,
        buildPacket,
      }),
    });

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(second);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <section id="dashboard" className="dash" aria-label="Base station dashboard">
      <TopBar />
      {mode === 'ops' ? (
        <>
          <Stats />
          <AlertCard />
          <Picker />
          <div className="stage">
            <div className="ops-left">
              <MapView />
              <ReplayBar />
              <div className="dock">
                <Feed />
                <PacketView />
              </div>
            </div>
            <NodePanel />
          </div>
        </>
      ) : (
        <Rescuer />
      )}
    </section>
  );
}
