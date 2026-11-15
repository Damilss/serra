'use client';

// Alert feed, newest first, with per-alert actions.

import { CLS, STATUS_LABEL, srcPeak } from '@/lib/alerts';
import { db, hms } from '@/lib/format';
import { NODES } from '@/lib/geo';
import { useDashboard } from '@/lib/store';
import { scrollToMap } from './AlertCard';

export function Feed() {
  const alerts = useDashboard((s) => s.alerts);
  const { setStatus, startReplay } = useDashboard.getState();

  return (
    <section className="card" aria-labelledby="feed-h">
      <div className="card-head">
        <h3 id="feed-h">Alert feed</h3>
        <span className="label" id="feed-count">
          {alerts.length} today
        </span>
      </div>
      <ul className="feed" id="feed">
        {alerts.map((a) => {
          const relaying = a.status === 'incoming';
          return (
            <li key={a.id}>
              <div className="top">
                <span className={`st ${a.status}`}>
                  <i />
                  {STATUS_LABEL[a.status]}
                </span>
                <span className="title">
                  {CLS[a.cls].title} · {NODES[a.src].name}
                </span>
              </div>
              <div className="meta">
                {relaying
                  ? `${hms(a.wall)} / relaying across Serranet`
                  : `${hms(a.wall)} / ${CLS[a.cls].word} / ${a.conf.toFixed(2)} / ${db(srcPeak(a))} dB / +${a.heard.length - 1} confirm / ${a.hops} hops / ${a.latency} ms`}
              </div>
              {a.note && <div className="note">{a.note}</div>}
              {!relaying && (
                <div className="acts">
                  {a.status === 'active' && (
                    <button className="btn" onClick={() => setStatus(a.id, 'ack')}>
                      Acknowledge
                    </button>
                  )}
                  {a.status !== 'resolved' && (
                    <button
                      className="btn"
                      onClick={() => setStatus(a.id, 'resolved', 'Resolved at base station.')}
                    >
                      Resolve
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => {
                      startReplay(a.id);
                      scrollToMap();
                    }}
                  >
                    Replay
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
