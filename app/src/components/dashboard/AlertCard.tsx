'use client';

// The Fog alert card for the open alert. Hidden while the alert is still relaying.

import { CLS, readings } from '@/lib/alerts';
import { hms, prefersReducedMotion } from '@/lib/format';
import { currentAlert, useDashboard } from '@/lib/store';
import { Summary } from './Summary';

export const scrollToMap = () =>
  document
    .getElementById('map')
    ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });

export function AlertCard() {
  const a = useDashboard((s) => currentAlert(s.alerts));
  const setStatus = useDashboard((s) => s.setStatus);
  const select = useDashboard((s) => s.select);
  const startReplay = useDashboard((s) => s.startReplay);
  if (!a || a.status === 'incoming') return null;
  const ack = a.status === 'ack';

  return (
    <div className={`alert-card on-fog${ack ? ' ack' : ''}`} id="alert-card" role="alert">
      <div>
        <div className="head">
          <span className="fdot" />
          <h2 id="ac-title">{CLS[a.cls].title}</h2>
          <span className="state" id="ac-state">
            {ack ? 'Acknowledged · team en route' : `Active · ${hms(a.wall)}`}
          </span>
        </div>
        <p id="ac-text">
          <Summary alert={a} />
        </p>
      </div>
      <div className="alert-actions">
        <button
          className="btn"
          id="ac-locate"
          onClick={() => {
            select(a.src);
            scrollToMap();
          }}
        >
          Locate
        </button>
        <button
          className="btn"
          id="ac-replay"
          onClick={() => {
            startReplay(a.id);
            scrollToMap();
          }}
        >
          Replay
        </button>
        {!ack && (
          <button className="btn solid" id="ac-ack" onClick={() => setStatus(a.id, 'ack')}>
            Acknowledge
          </button>
        )}
        <button
          className="btn"
          id="ac-resolve"
          onClick={() => setStatus(a.id, 'resolved', 'Resolved at base station.')}
        >
          Resolve
        </button>
      </div>
      <div className="readings" id="ac-readings">
        {readings(a).map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
