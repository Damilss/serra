'use client';

// Rescuer mode (phone, daylight): the open alert with bearing and distance from the ranger station,
// a relaying card while the alert hops in, or the all-clear card.

import { useEffect, useState } from 'react';
import { CLS, readings } from '@/lib/alerts';
import { A, C } from '@/lib/brand';
import { hm, hms, pad } from '@/lib/format';
import { NODES, bearing, coordStr, field, FIELD_COUNT, gridRef } from '@/lib/geo';
import { currentAlert, useDashboard } from '@/lib/store';
import type { Alert } from '@/lib/types';
import { SerranetMark } from '../brand/Logos';
import { Summary } from './Summary';

/** Re-renders every second (for "x s ago" and the clock). */
function useSecond() {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

const ago = (a: Alert) => {
  const s = Math.max(0, Math.round((Date.now() - a.wall.getTime()) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
};

function Compass({ deg }: { deg: number }) {
  return (
    <svg viewBox="0 0 120 120" aria-label={`Bearing ${Math.round(deg)} degrees`}>
      <circle cx="60" cy="60" r="55" fill="none" stroke={A(C.stone, 0.35)} strokeWidth="1.5" />
      <circle cx="60" cy="60" r="38" fill="none" stroke={A(C.stone, 0.2)} strokeWidth="1" />
      {[0, 90, 180, 270].map((d, k) => (
        <text
          key={d}
          x={60 + Math.sin((d * Math.PI) / 180) * 46}
          y={63.5 - Math.cos((d * Math.PI) / 180) * 46}
          textAnchor="middle"
          fontFamily="JetBrains Mono Variable, JetBrains Mono, monospace"
          fontSize="9"
          fill={C.stone}
        >
          {'NESW'[k]}
        </text>
      ))}
      <g transform={`rotate(${deg.toFixed(1)} 60 60)`}>
        <line x1="60" y1="60" x2="60" y2="22" stroke={C.night} strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="20" r="6" fill={C.flare} />
      </g>
      <rect x="56" y="56" width="8" height="8" transform="rotate(45 60 60)" fill={C.night} />
    </svg>
  );
}

export function Rescuer() {
  useSecond();
  const a = useDashboard((s) => currentAlert(s.alerts));
  const { setStatus, setMode, select, simulate } = useDashboard.getState();

  let card: React.ReactNode;
  if (a && a.status !== 'incoming') {
    const b = bearing(NODES[0], a.est);
    const ack = a.status === 'ack';
    card = (
      <div className="r-card fog on-fog">
        <div className="r-head">
          <span className={`fdot${ack ? ' ack' : ''}`} />
          <h2>{CLS[a.cls].title}</h2>
        </div>
        <span className="r-state">
          {ack ? 'Acknowledged · team en route' : `Active · ${hms(a.wall)} · ${ago(a)}`}
        </span>
        <div className="r-dir">
          <Compass deg={b.deg} />
          <div>
            <div className="r-bearing">
              {String(Math.round(b.deg)).padStart(3, '0')}°<small>{b.card}</small>
            </div>
            <div className="r-dist">
              {Math.round(b.dist / 10) * 10} m from Ranger Station
              <br />
              Search ~{Math.round(a.est.r / 10) * 10} m radius
            </div>
          </div>
        </div>
        <div className="r-line">
          <Summary alert={a} />
        </div>
        <div className="r-readings">
          {readings(a)
            .slice(0, 4)
            .map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
        </div>
        <div className="r-line muted">
          {coordStr(a.est)} · grid {gridRef(a.est)}
        </div>
        <div className="r-actions">
          {ack ? (
            <button
              className="btn solid"
              onClick={() => setStatus(a.id, 'resolved', 'Found. Resolved by field team.')}
            >
              Mark found
            </button>
          ) : (
            <button className="btn solid" onClick={() => setStatus(a.id, 'ack')}>
              Acknowledge
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              setMode('ops');
              select(a.src);
            }}
          >
            Open map
          </button>
        </div>
      </div>
    );
  } else if (a) {
    card = (
      <div className="r-card pine">
        <div className="r-head">
          <SerranetMark spinning style={{ height: 30 }} />
          <h2>Relaying</h2>
        </div>
        <div className="r-line muted">
          A Serranode heard something. The alert is hopping across the Serranet to the base station.
        </div>
      </div>
    );
  } else {
    card = (
      <div className="r-card pine">
        <span className="r-state">Hollow Pine Wilderness · {hm(new Date())}</span>
        <div className="r-head">
          <h2>All clear</h2>
        </div>
        <div className="r-line muted">
          No distress calls. {FIELD_COUNT} of {FIELD_COUNT} Serranodes listening.
        </div>
        <ul className="r-nodes">
          {NODES.slice(1).map((_, k) => {
            const n = field(k + 1);
            return (
              <li key={n.num}>
                <span>
                  N{pad(n.num)} · {n.name}
                </span>
                <span>
                  {n.batt}%{n.batt < 20 ? ' · low' : ''}
                </span>
              </li>
            );
          })}
        </ul>
        <button
          className="btn solid"
          style={{ padding: 16 }}
          onClick={() => simulate(1 + ((Math.random() * FIELD_COUNT) | 0))}
        >
          Simulate a call (demo)
        </button>
      </div>
    );
  }

  return (
    <div className="rescuer" id="rescuer">
      {card}
    </div>
  );
}
