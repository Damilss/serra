'use client';

// Side panel of the venue demo: the detected call (heard → classified on the node → flooded across the
// mesh → received at the base station, with each node's report), the live decoder link, the setup for
// the venue, and the log of calls. Detect-only: calls are not located on the floor.

import { useEffect, useState } from 'react';
import { LOCAL_URL, PI_URL, normaliseUrl } from '@/lib/decoder';
import { callTimeline } from '@/lib/draw/venue';
import { hex4, hms, now } from '@/lib/format';
import { useVenue, type VenueCall } from '@/lib/venueStore';

/** Seconds since the latest call started; re-renders while its animation is still running. */
function useCallClock(call: VenueCall | undefined) {
  const layout = useVenue((s) => s.layout);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!call) return;
    const end = callTimeline(layout, call).doneAt;
    const id = setInterval(() => {
      tick((n) => n + 1);
      if (!Number.isFinite(end) || now() - call.t0 > end) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [call, layout]);
  return call ? now() - call.t0 : -1;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (c: number | null) => (c === null ? '—' : `${Math.round(c * 100)}%`);
const hopText = (h: number) => (h === 0 ? 'direct' : `${h} hop${h === 1 ? '' : 's'}`);

type StepState = 'done' | 'active' | 'pending';

export function ResultCard() {
  const layout = useVenue((s) => s.layout);
  const call = useVenue((s) => s.calls[0]);
  const e = useCallClock(call);

  if (!call) {
    return (
      <div className="venue-block" id="venue-result">
        <span className="pill">
          <i />
          <span>Listening</span>
        </span>
        <h2 className="venue-title">No calls yet</h2>
        <p className="venue-note">
          Blow a whistle near a Serranode, or click the floor to simulate one. Each node that hears it
          classifies the sound on the device and floods an alert across the mesh to the base station.
        </p>
      </div>
    );
  }

  const tl = callTimeline(layout, call);
  const { levels } = call;
  const heardBy = layout.nodes.filter((_, i) => levels[i] !== null).map((n) => n.label);
  const top = Math.max(...levels.map((l) => l ?? -Infinity));
  const loudest = levels.indexOf(top);
  const conf = loudest >= 0 ? call.confidence[loudest] : null;
  const hops = call.hops.filter((h): h is number => h !== null);
  const fewestHops = hops.length ? Math.min(...hops) : null;

  // 0 listening · 1 heard · 2 classified, flooding · 3 received at the base station
  const stage = e >= tl.receivedAt ? 3 : e >= tl.firstClassifiedAt ? 2 : e >= tl.firstHeardAt ? 1 : 0;
  const state = (doneAt: number, activeAt: number): StepState =>
    stage >= doneAt ? 'done' : stage >= activeAt ? 'active' : 'pending';
  const pill = ['Listening…', 'Heard', 'Classified · flooding the mesh', 'Received at the base station'][
    stage
  ];

  const steps: { key: string; state: StepState; title: string; detail: string }[] = [
    {
      key: 'heard',
      state: state(1, 0),
      title: 'Heard',
      detail: `by ${heardBy.length} of ${layout.nodes.length} nodes (${heardBy.join(', ')})`,
    },
    {
      key: 'classified',
      state: state(2, 1),
      title: 'Classified on the node',
      detail: `${capital(call.cls)}, ${pct(conf)} confident · no internet`,
    },
    {
      key: 'flooded',
      state: state(3, 2),
      title: 'Flooded across the mesh',
      detail: `${heardBy.length} alert${heardBy.length === 1 ? '' : 's'}, relayed node to node over BLE`,
    },
    {
      key: 'received',
      state: state(3, 3),
      title: 'Received by the base station',
      detail:
        fewestHops === null
          ? 'decoded on the Raspberry Pi'
          : `decoded on the Raspberry Pi · ${hopText(fewestHops)}`,
    },
  ];

  return (
    <div className="venue-block" id="venue-result">
      <div className="venue-row">
        <span className={`pill ${stage === 3 ? 'alert' : ''}`} id="venue-stage">
          <i />
          <span>{pill}</span>
        </span>
        <span className="label" id="venue-source">
          {call.source === 'live' ? 'Live' : 'Simulated'} · {capital(call.cls)}
        </span>
      </div>
      <h2 className="venue-title">{stage < 2 ? 'Listening…' : `${capital(call.cls)} · ${pct(conf)}`}</h2>
      <ol className="venue-steps" id="venue-steps">
        {steps.map((s) => (
          <li key={s.key} data-step={s.key} data-state={s.state}>
            <b>{s.title}</b>
            <small>{s.state === 'pending' ? '…' : s.detail}</small>
          </li>
        ))}
      </ol>
      <table className="venue-readings">
        <thead>
          <tr>
            <th>Node</th>
            <th>Heard</th>
            <th>Class</th>
            <th>Conf.</th>
            <th>Hops</th>
          </tr>
        </thead>
        <tbody>
          {layout.nodes.map((n, i) => {
            const lv = levels[i];
            const reported = lv !== null;
            const h = call.hops[i];
            return (
              <tr key={n.label} className={i === loudest ? 'loudest' : undefined}>
                <td>
                  {n.label} <small>{hex4(n.nodeId)}</small>
                </td>
                <td>{reported ? `${lv.toFixed(1)} dB` : 'no report'}</td>
                <td>{reported && stage >= 2 ? (call.classes[i] ?? '—') : '—'}</td>
                <td>{reported && stage >= 2 ? pct(call.confidence[i]) : '—'}</td>
                <td>{reported && stage >= 3 && h !== null ? hopText(h) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {heardBy.length < layout.nodes.length && (
        <p className="venue-note" id="venue-partial">
          {heardBy.length === 1 ? 'Only one node' : 'Only some nodes'} reported this call. It still reached
          the base station: one node is enough to raise the alarm.
        </p>
      )}
      {loudest >= 0 && <p className="venue-note">Node {layout.nodes[loudest].label} heard it loudest.</p>}
    </div>
  );
}

const LINK_TEXT = {
  off: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live',
  down: 'Lost, retrying every 2 s',
} as const;

/** Connection to the base-station decoder, and which node is at which corner. */
export function LiveCard() {
  const s = useVenue();
  const [url, setUrl] = useState(s.decoderUrl);
  const [error, setError] = useState('');
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
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="venue-note">
        New Serranodes fill the corners in the order they&apos;re first heard. To check which is which,
        whistle right next to one: it should read loudest.
      </p>
      <div className="venue-row">
        <button className="btn ghost" onClick={s.resetNodeIds}>
          Reset IDs
        </button>
      </div>
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
        Mark where a simulated caller stood
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
        {calls.map((c) => {
          const heard = c.levels.filter((l) => l !== null).length;
          const top = Math.max(...c.levels.map((l) => l ?? -Infinity));
          const conf = c.confidence[c.levels.indexOf(top)] ?? null;
          return (
            <li key={c.id} data-source={c.source}>
              <span>{hms(c.wall)}</span>
              <span>
                {capital(c.cls)} {pct(conf)}
              </span>
              <span>
                heard by {heard}/{c.levels.length} · {c.source}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
