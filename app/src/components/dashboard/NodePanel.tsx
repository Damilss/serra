'use client';

// Serranode panel: name and status, the device label and board, the last audio capture, and the
// node's facts (location, battery, unique ID, link). Keyed on the selection so the swap animation
// replays when the node changes.

import { useState } from 'react';
import { CLS, rel } from '@/lib/alerts';
import { db, hex4, pad } from '@/lib/format';
import { BASE, coordStr, field, gridRef } from '@/lib/geo';
import { currentAlert, useDashboard } from '@/lib/store';
import { elevation } from '@/lib/terrain';
import { SerraLogo, SerranodeLogo } from '../brand/Logos';
import { PicoBoard } from './PicoBoard';
import { Waveform } from './Waveform';

function State({ sel }: { sel: number }) {
  const a = useDashboard((s) => currentAlert(s.alerts));
  const n = field(sel);
  const landed = a && a.status !== 'incoming' ? a : undefined;
  const h = landed?.heard.find((x) => x.i === sel);

  let label = 'Listening';
  let cls = '';
  if (landed && landed.src === sel) {
    label = CLS[landed.cls].title;
    cls = 'alert';
  } else if (h) {
    label = 'Confirming · quieter';
    cls = 'confirm';
  } else if (n.batt < 20) {
    label = 'Low battery';
    cls = 'low';
  }

  return (
    <>
      <div className="row">
        <SerranodeLogo />
        <span className={`pill ${cls}`} id="p-state">
          <i />
          <span>{label}</span>
        </span>
      </div>
      <h2 id="p-name">{n.name}</h2>
      <div className="reading" id="p-reading">
        {landed && h ? (
          <>
            <span
              className="fdot"
              style={{ opacity: landed.src === sel ? 1 : +(0.3 + 0.5 * rel(landed, h)).toFixed(2) }}
            />
            <span>Node {pad(n.num)}</span>
            <span className="slash">/</span>
            <span>{CLS[landed.cls].word}</span>
            <span className="slash">/</span>
            <span>{db(h.peak)} dB</span>
            <span className="slash">/</span>
            <span>{landed.src === sel ? 'heard first' : 'confirms'}</span>
          </>
        ) : (
          <span style={{ color: 'var(--moss)' }}>
            Node {pad(n.num)} / listening / {n.rssi} dBm
          </span>
        )}
      </div>
    </>
  );
}

function CopyId({ uid }: { uid: string }) {
  const [label, setLabel] = useState('Copy');
  return (
    <button
      className="copy"
      id="copy"
      onClick={async (e) => {
        try {
          await navigator.clipboard.writeText(uid);
          setLabel('Copied');
        } catch {
          const code = e.currentTarget.parentElement?.querySelector('code');
          if (code) {
            const r = document.createRange();
            r.selectNodeContents(code);
            const s = getSelection();
            s?.removeAllRanges();
            s?.addRange(r);
          }
          setLabel('Selected');
        }
        setTimeout(() => setLabel('Copy'), 1400);
      }}
    >
      {label}
    </button>
  );
}

function LastHeard({ sel }: { sel: number }) {
  const s = useDashboard((st) => st.lastHeard[sel]);
  return <b id="p-heard">{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`}</b>;
}

export function NodePanel() {
  const sel = useDashboard((s) => s.sel);
  const n = field(sel);
  const cells = Math.round(n.batt / 10);

  return (
    <aside className="panel" aria-label="Selected Serranode">
      <div className="panel-head swap" id="panel-head" key={`head-${sel}`}>
        <State sel={sel} />
      </div>
      <div className="device">
        <div className="node-label swap" key={`label-${sel}`}>
          <div className="row">
            <SerraLogo />
            <span className="label">Node label</span>
          </div>
          <div className="big" id="p-big">
            NODE {pad(n.num)}
          </div>
          <p>Listening for whistles, screams and calls for help. Please leave in place.</p>
        </div>
        <div className="board">
          <PicoBoard tag={hex4(n.nodeId)} />
          <div className="board-caption">
            <span>Pico 2 W · RP2350 · CYW43439 BLE</span>
            <span>fw 0.1.0-arm</span>
          </div>
        </div>
      </div>
      <Waveform />
      <dl className="facts-list swap" id="facts" key={`facts-${sel}`}>
        <div className="fact">
          <dt className="label">Location</dt>
          <dd>
            <span className="big" id="p-loc">
              {n.name}
            </span>
            <span className="sub" id="p-coords">
              {coordStr(n)}
            </span>
            <span className="sub" id="p-grid">
              Grid {gridRef(n)} · {elevation(n).toLocaleString()} m
            </span>
          </dd>
        </div>
        <div className="fact">
          <dt className="label">Battery</dt>
          <dd>
            <div className="batt">
              <span className="batt-num" id="p-batt">
                {n.batt}
                <small>%</small>
              </span>
              <div className={`cells${n.batt >= 50 ? ' full' : ''}`} id="cells" aria-hidden="true">
                {Array.from({ length: 10 }, (_, k) => (
                  <i key={k} className={k < cells ? 'on' : undefined} />
                ))}
              </div>
            </div>
            <span className="sub" id="p-volts">
              {n.volts.toFixed(2)} V · about {Math.round(n.batt * 2.7)} h left
              {n.batt < 20 ? ' · swap soon' : ''}
            </span>
          </dd>
        </div>
        <div className="fact">
          <dt className="label">Unique ID</dt>
          <dd>
            <div className="uid">
              <code id="p-uid">{n.uid.match(/.{4}/g)!.join(' ')}</code>
              <CopyId uid={n.uid} />
            </div>
            <span className="sub" id="p-nodeid">
              Mesh ID {hex4(n.nodeId)} · from flash serial
            </span>
          </dd>
        </div>
        <div className="fact">
          <dt className="label">Link</dt>
          <dd className="tele">
            <div>
              <span className="label">Signal</span>
              <b id="p-rssi">{n.rssi} dBm</b>
            </div>
            <div>
              <span className="label">Hops</span>
              <b id="p-hops">{BASE.dist[sel]}</b>
            </div>
            <div>
              <span className="label">Last heard</span>
              <LastHeard sel={sel} />
            </div>
          </dd>
        </div>
      </dl>
    </aside>
  );
}
