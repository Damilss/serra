'use client';

// Top bar: brand lockup, Serranet status, sound toggle, rescuer mode toggle and the clock.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { hms } from '@/lib/format';
import { FIELD_COUNT } from '@/lib/geo';
import { useDashboard } from '@/lib/store';
import { SerraLogo, SerranetMark } from '../brand/Logos';
import { SiteNav } from '../SiteNav';

export function Clock() {
  const [t, setT] = useState('--:--:--');
  useEffect(() => {
    const tick = () => setT(hms(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <b id="clock">{t}</b>;
}

export function TopBar() {
  const mode = useDashboard((s) => s.mode);
  const soundOn = useDashboard((s) => s.soundOn);
  const setMode = useDashboard((s) => s.setMode);
  const toggleSound = useDashboard((s) => s.toggleSound);

  return (
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Serra home">
        <SerraLogo />
        <span className="sep" />
        <span className="label">Base station · Ranger Station</span>
      </Link>
      <SiteNav />
      <div className="chips">
        <span className="chip">
          <SerranetMark />
          <b>
            {FIELD_COUNT}/{FIELD_COUNT}
          </b>{' '}
          Serranodes online
        </span>
        <span className="chip">
          Uplink <b>none · local Wi-Fi</b>
        </span>
        <button className="chip" id="sound-btn" aria-pressed={false} onClick={toggleSound}>
          Sound <b>{soundOn ? 'on' : 'off'}</b>
        </button>
        <button
          className="chip"
          id="mode-btn"
          aria-pressed={mode === 'rescuer'}
          onClick={() => setMode(mode === 'ops' ? 'rescuer' : 'ops')}
        >
          Rescuer mode
        </button>
        <span className="chip">
          <Clock />
        </span>
      </div>
    </header>
  );
}
