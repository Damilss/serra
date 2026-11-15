'use client';

// Side panel of the venue demo: the located call (estimate, uncertainty, each node's reading against
// the fit), the setup for the venue, and the log of calls.

import { useEffect, useState } from 'react';
import { callTimeline } from '@/lib/draw/venue';
import { hex4, hms, now } from '@/lib/format';
import { dist, toFt } from '@/lib/venue';
import { useVenue, type VenueCall } from '@/lib/venueStore';

/** True once the call's fix should be on screen (after the sound and the relay, as on the map). */
function useRevealed(call: VenueCall | undefined) {
  const layout = useVenue((s) => s.layout);
  const [revealedId, setRevealedId] = useState<number | null>(null);
  useEffect(() => {
    if (!call) return;
    const wait = Math.max(0, callTimeline(layout, call).fixAt - (now() - call.t0));
    const id = setTimeout(() => setRevealedId(call.id), wait * 1000);
    return () => clearTimeout(id);
  }, [call, layout]);
  return !!call && revealedId === call.id;
}

const ft = (m: number) => `${toFt(m).toFixed(1)} ft`;

export function ResultCard() {
  const layout = useVenue((s) => s.layout);
  const call = useVenue((s) => s.calls[0]);
  const revealed = useRevealed(call);

  if (!call) {
    return (
      <div className="venue-block">
        <span className="pill">
          <i />
          <span>Listening</span>
        </span>
        <h2 className="venue-title">No calls yet</h2>
        <p className="venue-note">
          Blow a whistle near the triangle, or click the floor to simulate one. All three Serranodes report
          how loud they heard it, and the base station works out where it came from.
        </p>
      </div>
    );
  }

  const levels = call.readings.map((r) => r.peak / 10);
  const loudest = levels.indexOf(Math.max(...levels));
  const off = call.truth ? dist(call.truth, call.fix) : null;

  return (
    <div className="venue-block" id="venue-result">
      <span className={`pill ${revealed ? 'alert' : ''}`}>
        <i />
        <span>{!revealed ? 'Locating…' : call.fix.alt ? 'Two possible spots' : 'Call located'}</span>
      </span>
      <h2 className="venue-title">
        {revealed ? `Within ±${ft(call.fix.r)}` : 'Listening to all three nodes'}
      </h2>
      {revealed && call.fix.alt && (
        <p className="venue-note" id="venue-ambiguous">
          The readings fit a second spot about as well ({ft(call.fix.alt.x)}, {ft(call.fix.alt.y)}), marked
          “or here?” on the map. With three nodes this happens near an edge or a node; a fourth node would
          settle it.
        </p>
      )}
      <dl className="venue-stats">
        <div>
          <dt className="label">Estimate</dt>
          <dd id="venue-est">{revealed ? `${ft(call.fix.x)}, ${ft(call.fix.y)}` : '—'}</dd>
        </div>
        <div>
          <dt className="label">Search circle</dt>
          <dd id="venue-radius">{revealed ? `±${ft(call.fix.r)}` : '—'}</dd>
        </div>
        {off !== null && (
          <div>
            <dt className="label">Off by</dt>
            <dd id="venue-off">{revealed ? ft(off) : '—'}</dd>
          </div>
        )}
        <div>
          <dt className="label">Call level at 1 m</dt>
          <dd>{revealed ? `${call.fix.l0.toFixed(1)} dB` : '—'}</dd>
        </div>
      </dl>
      <table className="venue-readings">
        <thead>
          <tr>
            <th>Node</th>
            <th>Heard</th>
            <th>Fit</th>
            <th>Distance</th>
          </tr>
        </thead>
        <tbody>
          {layout.nodes.map((n, i) => (
            <tr key={n.label} className={i === loudest ? 'loudest' : undefined}>
              <td>
                {n.label} <small>{hex4(n.nodeId)}</small>
              </td>
              <td>{levels[i].toFixed(1)} dB</td>
              <td>{revealed ? `${call.fix.predicted[i].toFixed(1)} dB` : '—'}</td>
              <td>{revealed ? ft(dist(n, call.fix)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="venue-note">
        {loudest >= 0 && `Node ${layout.nodes[loudest].label} heard it loudest. `}
        Each node&apos;s level is compared with how loud the call would be from every spot on the floor; the
        estimate is the spot that explains all three best.
      </p>
    </div>
  );
}

export function SetupCard() {
  const sideFt = useVenue((s) => s.layout.sideFt);
  const showTruth = useVenue((s) => s.showTruth);
  const jitterDb = useVenue((s) => s.jitterDb);
  const { setSideFt, setShowTruth, setJitter, clear } = useVenue.getState();
  const [side, setSide] = useState(String(sideFt));
  const [error, setError] = useState('');

  return (
    <div className="venue-block">
      <span className="label">Setup</span>
      <form
        className="venue-form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = Number(side);
          if (!Number.isFinite(v) || v < 5 || v > 200) {
            setError('Enter a side length between 5 and 200 ft.');
            return;
          }
          setError('');
          setSideFt(v);
        }}
      >
        <label htmlFor="venue-side">Triangle side (ft)</label>
        <div className="venue-row">
          <input
            id="venue-side"
            inputMode="decimal"
            value={side}
            onChange={(e) => {
              setSide(e.target.value);
              setError('');
            }}
          />
          <button className="btn" type="submit">
            Apply
          </button>
        </div>
        {error && <span className="venue-error">{error}</span>}
      </form>
      <label className="venue-check">
        <input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} />
        Show where the caller really was (rehearsal)
      </label>
      <label className="venue-check">
        Measurement noise
        <select value={jitterDb} onChange={(e) => setJitter(+e.target.value)} aria-label="Measurement noise">
          <option value={0}>none</option>
          <option value={1}>±1 dB</option>
          <option value={2}>±2 dB</option>
          <option value={4}>±4 dB (loud room)</option>
        </select>
      </label>
      <button className="btn ghost" onClick={clear}>
        Clear calls
      </button>
    </div>
  );
}

export function CallLog() {
  const calls = useVenue((s) => s.calls);
  if (!calls.length) return null;
  return (
    <div className="venue-block">
      <span className="label">Calls · {calls.length}</span>
      <ul className="venue-log" id="venue-log">
        {calls.map((c) => (
          <li key={c.id}>
            <span>{hms(c.wall)}</span>
            <span>±{toFt(c.fix.r).toFixed(1)} ft</span>
            <span>{c.truth ? `off ${toFt(dist(c.truth, c.fix)).toFixed(1)} ft` : c.source}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
