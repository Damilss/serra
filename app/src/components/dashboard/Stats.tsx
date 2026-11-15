'use client';

// Stat tiles: latency of the last alert and alert counts are live; the rest are mock figures.

import { useDashboard } from '@/lib/store';

export function Stats() {
  const alerts = useDashboard((s) => s.alerts);
  const last = alerts.find((a) => a.status !== 'incoming' && a.start > 0);
  const open = alerts.filter((a) => a.status !== 'resolved').length;

  return (
    <div className="stats">
      <span className="mock-tag">Mock figures</span>
      <div className="stat" id="st-lat">
        <span className="label">End-to-end latency</span>
        <b>
          {last ? (
            <>
              {last.latency}
              <small>ms</small>
            </>
          ) : (
            '—'
          )}
        </b>
        <em>{last ? `${last.hops} hops · call → base` : 'Waiting for first alert'}</em>
      </div>
      <div className="stat">
        <span className="label">Inference</span>
        <b>
          38<small>ms</small>
        </b>
        <em>int8 CNN · Cortex-M33</em>
      </div>
      <div className="stat">
        <span className="label">Energy / detection</span>
        <b>
          1.9<small>mJ</small>
        </b>
        <em>wake → classify → transmit</em>
      </div>
      <div className="stat">
        <span className="label">Serranode battery</span>
        <b>
          11.4<small>days</small>
        </b>
        <em>2,000 mAh · 2% radio duty</em>
      </div>
      <div className="stat" id="st-alerts">
        <span className="label">Alerts today</span>
        <b>{alerts.length}</b>
        <em>{open} active</em>
      </div>
    </div>
  );
}
