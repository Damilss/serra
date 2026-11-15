'use client';

// The base station's start-up log on the welcome screen, revealed one line at a time.

import { useEffect, useState } from 'react';
import { hm, pad } from '@/lib/format';
import { NODES } from '@/lib/geo';
import { MESH_MAGIC } from '@/lib/packets';
import { SerranetMark } from '../brand/Logos';

const BOOT: [string, string, boolean?][] = [
  ['Serra base station 0.1.0 · Pi 5', 'ok'],
  ['BLE scanner (bleak)', 'up'],
  [`Filter company 0xFFFF · magic 0x${MESH_MAGIC.toString(16).toUpperCase()}`, 'set'],
  ['Dedup cache (src, msg_id)', 'ready'],
  ...NODES.flatMap((n): [string, string][] =>
    n.kind === 'field' ? [[`N${pad(n.num)} ${n.name}`, `${n.rssi} dBm`]] : [],
  ),
  ['Local Wi-Fi SERRA-BASE', 'broadcasting'],
  ['Serranet online', '5/5', true],
];

export function BootLog() {
  const [lines, setLines] = useState<{ t: string; i: number }[]>([]);
  const [clock, setClock] = useState('00:00');

  useEffect(() => {
    const t0 = performance.now();
    const stamp = () => ((performance.now() - t0) / 1000).toFixed(2).padStart(6, '0');
    const timers = BOOT.map((_, i) =>
      setTimeout(() => setLines((l) => [...l, { t: stamp(), i }]), 450 + i * 280 + (i > 3 ? 200 : 0)),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const tick = () => setClock(hm(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const done = lines.length === BOOT.length;
  return (
    <div className="boot" role="log" aria-label="Base station start-up log">
      <div className="boot-head">
        <span id="boot-spin">
          <SerranetMark spinning={!done} />
        </span>
        <span className="label" id="boot-state" style={{ color: 'var(--fog)' }}>
          {done ? 'Serranet online' : 'Joining Serranet'}
        </span>
        <span className="label" id="boot-clock">
          {clock}
        </span>
      </div>
      <ol id="boot">
        {lines.map(({ t, i }) => {
          const [k, v, fin] = BOOT[i];
          return (
            <li key={i} className={fin ? 'final' : undefined}>
              <span className="t">{t}</span>
              <span className="k">{k}</span>
              <span className="lead" />
              <span className="v">{v}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
