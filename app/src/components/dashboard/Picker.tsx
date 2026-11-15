'use client';

// Node picker row: "Viewing" dropdown, ← → stepper, which sound to simulate, and Simulate.

import { pad } from '@/lib/format';
import { NODES, nn } from '@/lib/geo';
import { incomingAlert, useDashboard } from '@/lib/store';
import type { AlertClass } from '@/lib/types';
import { CallIcon } from '../brand/Logos';

const CLASSES: [AlertClass, string][] = [
  ['whistle', 'Whistle'],
  ['scream', 'Scream'],
  ['help', '“Help”'],
];

export function Picker() {
  const sel = useDashboard((s) => s.sel);
  const simClass = useDashboard((s) => s.simClass);
  const busy = useDashboard((s) => !!incomingAlert(s.alerts));
  const { select, step, setSimClass, simulate } = useDashboard.getState();

  return (
    <div className="picker">
      <span className="label">Viewing</span>
      <div className="select-wrap">
        <select id="node-select" aria-label="Serranode" value={sel} onChange={(e) => select(+e.target.value)}>
          {NODES.map((n, i) =>
            n.kind === 'field' ? (
              <option key={i} value={i}>
                Serranode {pad(n.num)} · {n.name}
              </option>
            ) : null,
          )}
        </select>
      </div>
      <div className="stepper">
        <button className="icon-btn" id="prev" aria-label="Previous Serranode" onClick={() => step(-1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <button className="icon-btn" id="next" aria-label="Next Serranode" onClick={() => step(1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <span className="kbd">
        <kbd>←</kbd> <kbd>→</kbd> switch · <kbd>W</kbd> simulate
      </span>
      <div className="right">
        <div className="seg" role="group" aria-label="Sound to simulate">
          {CLASSES.map(([c, label]) => (
            <button key={c} data-cls={c} aria-pressed={simClass === c} onClick={() => setSimClass(c)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn sim" id="sim-btn" disabled={busy} onClick={() => simulate(sel)}>
          <CallIcon />
          <span id="sim-label">{busy ? 'Relaying…' : `Simulate at ${nn(sel)}`}</span>
        </button>
      </div>
    </div>
  );
}
