'use client';

// Serranet packets: the bytes of one advertisement colored by field group, the field-by-field decode,
// and the log. Click a log row to pin it; "Resume live" follows new packets again.

import { C } from '@/lib/brand';
import { hex2, hms } from '@/lib/format';
import { nn } from '@/lib/geo';
import { hexOf } from '@/lib/packets';
import { shownPacket, useDashboard } from '@/lib/store';

export function PacketView() {
  const packets = useDashboard((s) => s.packets);
  const pinnedId = useDashboard((s) => s.pinnedId);
  const pinPacket = useDashboard((s) => s.pinPacket);
  const p = shownPacket({ packets, pinnedId });
  if (!p) return null;
  const col = { ad: C.stone, hdr: C.moss, pl: p.kind === 'alert' ? C.flare : C.fog };

  return (
    <section className="card" aria-labelledby="pk-h">
      <div className="card-head">
        <h3 id="pk-h">Serranet packets</h3>
        <button
          className="btn ghost"
          id="pk-live"
          style={{ padding: '6px 11px', fontSize: 12 }}
          onClick={() => pinPacket(null)}
        >
          {pinnedId !== null ? 'Resume live' : 'Following live'}
        </button>
      </div>
      <div className="pk-wrap">
        <div className="hexview" id="hexview">
          {p.fields.map((f) => (
            <div key={f.name} className="fld" style={{ '--fc': col[f.grp] } as React.CSSProperties}>
              <div className="bytes">
                {f.bytes.map((b, i) => (
                  <i key={i}>{hex2(b)}</i>
                ))}
              </div>
              <small>{f.name}</small>
            </div>
          ))}
        </div>
        <dl className="decode" id="decode">
          <dt>packet</dt>
          <dd>
            {p.kind === 'alert' ? 'ALERT' : 'HEARTBEAT'} · {p.size} B advertising data · {hms(p.time)}
          </dd>
          {p.fields.slice(3).map((f) => (
            <Row key={f.name} name={f.name} val={f.val} />
          ))}
        </dl>
        <ul className="pklog" id="pklog">
          {packets.slice(0, 12).map((q) => (
            <li key={q.id} className={q === p ? 'on' : ''} onClick={() => pinPacket(q.id)}>
              <span>{hms(q.time)}</span>
              <span className={`ty ${q.kind === 'alert' ? 'a' : ''}`}>
                {q.kind === 'alert' ? 'ALERT' : 'HB'}
              </span>
              <span className="hx">{hexOf(q)}</span>
              <span>{nn(q.src)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Row({ name, val }: { name: string; val: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{val}</dd>
    </>
  );
}
