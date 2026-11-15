'use client';

// Side panel of the venue demo: the located call (estimate, uncertainty, each node's reading against
// the fit), the live decoder link, the setup for the venue, and the log of calls.

import { useEffect, useState } from 'react';
import { LOCAL_URL, PI_URL, normaliseUrl } from '@/lib/decoder';
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
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

  const { fix, levels } = call;
  const heardBy = layout.nodes.filter((_, i) => levels[i] !== null).map((n) => n.label);
  const top = Math.max(...levels.map((l) => l ?? -Infinity));
  const loudest = levels.indexOf(top);
  const off = call.truth && fix ? dist(call.truth, fix) : null;
  const pill = !revealed
    ? 'Locating…'
    : !fix
      ? `Heard by ${heardBy.join(' + ')} only`
      : fix.alt
        ? 'Two possible spots'
        : 'Call located';

  return (
    <div className="venue-block" id="venue-result">
      <div className="venue-row">
        <span className={`pill ${revealed && fix ? 'alert' : ''}`}>
          <i />
          <span>{pill}</span>
        </span>
        <span className="label" id="venue-source">
          {call.source === 'live' ? 'Live' : 'Simulated'} · {capital(call.cls)}
        </span>
      </div>
      <h2 className="venue-title">
        {!revealed ? 'Listening to all three nodes' : fix ? `Within ±${ft(fix.r)}` : 'Not located'}
      </h2>
      {revealed && !fix && (
        <p className="venue-note" id="venue-partial">
          Only {heardBy.length === 1 ? 'one node' : 'two nodes'} reported this call, and locating it needs all
          three. {heardBy.length === 1 && `It was near node ${heardBy[0]}. `}Try again a little louder, or
          closer to the middle of the triangle.
        </p>
      )}
      {revealed && fix?.alt && (
        <p className="venue-note" id="venue-ambiguous">
          The readings fit a second spot about as well ({ft(fix.alt.x)}, {ft(fix.alt.y)}), marked “or here?”
          on the map. With three nodes this happens near an edge or a node; a fourth node would settle it.
        </p>
      )}
      {fix && (
        <dl className="venue-stats">
          <div>
            <dt className="label">Estimate</dt>
            <dd id="venue-est">{revealed ? `${ft(fix.x)}, ${ft(fix.y)}` : '—'}</dd>
          </div>
          <div>
            <dt className="label">Search circle</dt>
            <dd id="venue-radius">{revealed ? `±${ft(fix.r)}` : '—'}</dd>
          </div>
          {off !== null && (
            <div>
              <dt className="label">Off by</dt>
              <dd id="venue-off">{revealed ? ft(off) : '—'}</dd>
            </div>
          )}
          <div>
            <dt className="label">Call level at 1 m</dt>
            <dd>{revealed ? `${fix.l0.toFixed(1)} dB` : '—'}</dd>
          </div>
        </dl>
      )}
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
          {layout.nodes.map((n, i) => {
            const lv = levels[i];
            return (
              <tr key={n.label} className={i === loudest ? 'loudest' : undefined}>
                <td>
                  {n.label} <small>{hex4(n.nodeId)}</small>
                </td>
                <td>{lv === null ? 'no report' : `${lv.toFixed(1)} dB`}</td>
                <td>{revealed && fix ? `${fix.predicted[i].toFixed(1)} dB` : '—'}</td>
                <td>{revealed && fix ? ft(dist(n, fix)) : '—'}</td>
              </tr>
            );
          })}
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

const LINK_TEXT = {
  off: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live',
  down: 'Lost, retrying every 2 s',
} as const;

/** Connection to the base-station decoder, which node is at which corner, and calibration. */
export function LiveCard() {
  const s = useVenue();
  const [url, setUrl] = useState(s.decoderUrl);
  const [error, setError] = useState('');
  const [calMsg, setCalMsg] = useState('');
  // re-render once a second so "last packet N s ago" stays current
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const connect = (target: string) => {
    const u = normaliseUrl(target);
    if (!u) {
      setError('Enter the decoder address, like 10.12.194.1:8080.');
      return;
    }
    setError('');
    setUrl(u);
    s.setDecoderUrl(u);
    s.setLiveOn(true);
  };

  const h = s.health;
  const ago = s.lastPacketAt === null ? null : Math.round(now() - s.lastPacketAt);
  const seenIds = Object.values(s.seen)
    .sort((a, b) => a.id - b.id)
    .map((n) => n.id);
  const options = [...new Set([...s.nodeIds, ...seenIds])];

  return (
    <div className="venue-block" id="venue-live">
      <div className="venue-row">
        <span className="label">Live decoder</span>
        <span className={`pill ${s.liveOn && s.link === 'live' ? 'ok' : ''}`} id="venue-link">
          <i />
          <span>{s.liveOn ? LINK_TEXT[s.link] : 'Off · simulated calls only'}</span>
        </span>
      </div>
      <form
        className="venue-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (s.liveOn) s.setLiveOn(false);
          else connect(url);
        }}
      >
        <label htmlFor="venue-url">Decoder address</label>
        <div className="venue-row">
          <input
            id="venue-url"
            value={url}
            spellCheck={false}
            onChange={(e) => {
              setUrl(e.target.value);
              setError('');
            }}
          />
          <button className="btn" type="submit">
            {s.liveOn ? 'Disconnect' : 'Connect'}
          </button>
        </div>
        <div className="venue-row">
          <button type="button" className="btn ghost" onClick={() => connect(PI_URL)}>
            Pi over USB
          </button>
          <button type="button" className="btn ghost" onClick={() => connect(LOCAL_URL)}>
            This laptop
          </button>
        </div>
        {error && <span className="venue-error">{error}</span>}
      </form>
      {s.liveOn && (
        <p className="venue-note" id="venue-health">
          {h
            ? `serra-base ${h.version} · source ${h.source} · scanner ${h.scanner} · ${h.counts.packets ?? 0} packets`
            : 'No answer from /health yet.'}
          {ago !== null && ` · last packet ${ago} s ago`}
        </p>
      )}

      <span className="label">Nodes at the corners</span>
      <table className="venue-readings" id="venue-nodes">
        <thead>
          <tr>
            <th>Corner</th>
            <th>Mesh ID</th>
            <th>Last heard</th>
            <th>Calibration</th>
          </tr>
        </thead>
        <tbody>
          {s.layout.nodes.map((n, i) => {
            const seen = s.seen[n.nodeId];
            return (
              <tr key={n.label}>
                <td>{n.label}</td>
                <td>
                  <select
                    aria-label={`Node at corner ${n.label}`}
                    value={n.nodeId}
                    onChange={(e) => s.setNodeId(i, +e.target.value)}
                  >
                    {options.map((id) => (
                      <option key={id} value={id}>
                        {hex4(id)}
                        {s.seen[id] ? '' : ' (not heard)'}
                      </option>
                    ))}
                  </select>
                  {!s.assigned[i] && <small> default</small>}
                </td>
                <td>{seen ? `${(seen.peak / 10).toFixed(1)} dB` : '—'}</td>
                <td>{`${s.offsets[i] >= 0 ? '+' : ''}${s.offsets[i].toFixed(1)} dB`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="venue-note">
        New Serranodes fill the corners in the order they&apos;re first heard. To check which is which,
        whistle right next to one corner: it should read loudest. To even out the microphones, whistle at X1
        (the centre), then press Calibrate.
      </p>
      <div className="venue-row">
        <button
          className="btn"
          id="venue-calibrate"
          onClick={() =>
            setCalMsg(
              s.calibrate()
                ? 'Calibrated from the last live call.'
                : 'Needs a live call heard by all three nodes first.',
            )
          }
        >
          Calibrate at X1
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            s.resetCalibration();
            setCalMsg('');
          }}
        >
          Reset calibration
        </button>
        <button className="btn ghost" onClick={s.resetNodeIds}>
          Reset IDs
        </button>
      </div>
      {calMsg && <span className="venue-note">{calMsg}</span>}
    </div>
  );
}

export function SetupCard() {
  const sideFt = useVenue((s) => s.layout.sideFt);
  const showTruth = useVenue((s) => s.showTruth);
  const jitterDb = useVenue((s) => s.jitterDb);
  const insideOnly = useVenue((s) => s.insideOnly);
  const { setSideFt, setShowTruth, setJitter, setInsideOnly, clear } = useVenue.getState();
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
        <input type="checkbox" checked={insideOnly} onChange={(e) => setInsideOnly(e.target.checked)} />
        Callers stand inside the triangle
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
          <li key={c.id} data-source={c.source}>
            <span>{hms(c.wall)}</span>
            <span>{c.fix ? `±${toFt(c.fix.r).toFixed(1)} ft` : 'not located'}</span>
            <span>
              {c.truth && c.fix
                ? `off ${toFt(dist(c.truth, c.fix)).toFixed(1)} ft`
                : `${c.source} · ${c.cls}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
