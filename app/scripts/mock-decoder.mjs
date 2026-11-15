#!/usr/bin/env node
// Stand-in for the base-station decoder (serra-base), for rehearsing the /demo page with no Pi and
// no Picos. Serves the same GET /events (SSE) and GET /health as serra-base on the Pi
// (base-station/README.md, "Output: event stream"), with three Serranodes on a triangle.
//
// Every few seconds a call happens at a random spot in the triangle (or at a taped mark), and each
// node sends its own ALERT with the level it would hear: the same thing three real Serranodes do.
//
//   npm run mock:decoder                      # port 8080, a call every 4 s
//   npm run mock:decoder -- --at X1           # always at the centre mark (to try Calibrate)
//   npm run mock:decoder -- --skew 0,2.5,-1.5 # uneven microphones, dB per node A,B,C
//   npm run mock:decoder -- --miss 0.2        # each node misses a call 20% of the time
//
// Then on /demo: Live decoder → This laptop (http://localhost:8080).

import http from 'node:http';
import { randomBytes } from 'node:crypto';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(/\s*--/)
    .filter(Boolean)
    .map((a) => {
      const [k, ...v] = a.split(/\s+/);
      return [k, v.join(' ') || 'true'];
    }),
);
const PORT = Number(args.port ?? 8080);
const INTERVAL = Number(args.interval ?? 4) * 1000;
const SIDE_FT = Number(args.side ?? 20);
const MISS = Number(args.miss ?? 0);
const NOISE = Number(args.noise ?? 1);
const SKEW = (args.skew ?? '0,0,0').split(',').map(Number);
const AT = args.at ?? null;

// Same triangle as the page's makeLayout(): metres, A bottom-left, B bottom-right, C top.
const FT = 0.3048;
const MARGIN = 1.6;
const s = SIDE_FT * FT;
const h = (s * Math.sqrt(3)) / 2;
const NODES = [
  { id: 0x1c4e, label: 'A', x: MARGIN, y: MARGIN + h },
  { id: 0x2a10, label: 'B', x: MARGIN + s, y: MARGIN + h },
  { id: 0x3b7f, label: 'C', x: MARGIN + s / 2, y: MARGIN },
];
const centre = { x: MARGIN + s / 2, y: MARGIN + h - h / 3 };
const MARKS = {
  X1: centre,
  X2: { x: NODES[0].x + (centre.x - NODES[0].x) * 0.25, y: NODES[0].y + (centre.y - NODES[0].y) * 0.25 },
  X3: { x: (NODES[1].x + NODES[2].x) / 2, y: (NODES[1].y + NODES[2].y) / 2 },
};
const CALL_DB_1M = 100;
const CLASSES = [
  ['whistle', 1],
  ['scream', 2],
  ['help', 3],
];

const runId = randomBytes(3).toString('hex');
const started = Date.now();
const clients = new Set();
const counts = { adverts: 0, packets: 0, duplicates: 0, bad_magic: 0, too_short: 0, unknown_type: 0 };
let seq = 0;
const msgIds = NODES.map(() => Math.floor(Math.random() * 0x10000));

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const u16 = (v) => [v & 255, (v >> 8) & 255];
const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

function publish(event) {
  seq++;
  counts.adverts++;
  counts.packets++;
  const body = { run_id: runId, seq, t_ms: Date.now() - started, ...event };
  const frame = `id: ${runId}:${seq}\nevent: packet\ndata: ${JSON.stringify(body)}\n\n`;
  for (const res of clients) res.write(frame);
}

function alert(i, cls, classId, peak) {
  const n = NODES[i];
  msgIds[i] = (msgIds[i] + 1) & 0xffff;
  const conf = 150 + Math.floor(Math.random() * 100);
  const ts = (Date.now() - started + 60_000 * (i + 1)) >>> 0;
  const blasts = cls === 'whistle' ? 3 : 0;
  const raw = [0x5e, ...u16(n.id), 0xff, 0xff, ...u16(msgIds[i]), 4, 1];
  raw.push(classId, conf, ...u16(peak & 0xffff), ...u32(ts), blasts);
  publish({
    rssi: -50 - Math.floor(Math.random() * 20),
    raw: hex(raw),
    magic: 0x5e,
    src: n.id,
    dst: 0xffff,
    msg_id: msgIds[i],
    ttl: 4,
    hops: 0,
    type: 'ALERT',
    alert: {
      class: cls,
      confidence: Math.round((conf / 255) * 1e4) / 1e4,
      peak_level: peak,
      peak_db: peak / 10,
      timestamp: ts,
      blast_count: blasts,
    },
  });
}

function call() {
  let p = AT && MARKS[AT];
  if (!p) {
    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) [u, v] = [1 - u, 1 - v];
    const [A, B, C] = NODES;
    p = { x: A.x + u * (B.x - A.x) + v * (C.x - A.x), y: A.y + u * (B.y - A.y) + v * (C.y - A.y) };
  }
  const [cls, classId] = CLASSES[Math.random() < 0.6 ? 0 : 1 + Math.floor(Math.random() * 2)];
  const heard = [];
  NODES.forEach((n, i) => {
    if (Math.random() < MISS) return;
    const d = Math.max(0.3, Math.hypot(n.x - p.x, n.y - p.y));
    const db = CALL_DB_1M - 20 * Math.log10(d) + (Math.random() - 0.5) * 2 * NOISE + (SKEW[i] ?? 0);
    const peak = Math.round(db * 10);
    heard.push(`${n.label} ${(peak / 10).toFixed(1)}`);
    // nodes finish classifying at slightly different moments
    setTimeout(() => alert(i, cls, classId, peak), 50 + Math.random() * 400);
  });
  const at = `(${(p.x / FT).toFixed(1)} ft, ${(p.y / FT).toFixed(1)} ft)`;
  console.log(`${cls} at ${AT ?? 'random spot'} ${at} · heard: ${heard.join(', ') || 'none'}`);
}

function heartbeat() {
  const i = Math.floor(Math.random() * NODES.length);
  msgIds[i] = (msgIds[i] + 1) & 0xffff;
  const n = NODES[i];
  publish({
    rssi: -60,
    raw: hex([0x5e, ...u16(n.id), 0xff, 0xff, ...u16(msgIds[i]), 4, 2]),
    magic: 0x5e,
    src: n.id,
    dst: 0xffff,
    msg_id: msgIds[i],
    ttl: 4,
    hops: 0,
    type: 'HEARTBEAT',
  });
}

const CORS = { 'Access-Control-Allow-Origin': '*' };
const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS,
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(
      JSON.stringify({
        version: 'mock',
        run_id: runId,
        source: 'mock',
        scanner: 'up',
        company_id: 0xffff,
        magic: 0x5e,
        uptime_s: Math.floor((Date.now() - started) / 1000),
        clients: clients.size,
        counts,
      }),
    );
    return;
  }
  res.writeHead(404, CORS).end();
});

server.on('error', (e) => {
  console.error(`mock decoder: ${e.message}`);
  process.exit(2);
});
server.listen(PORT, () => {
  console.log(`mock decoder on http://localhost:${PORT} (run ${runId}): nodes A 0x1C4E, B 0x2A10, C 0x3B7F`);
  console.log(`a call every ${INTERVAL / 1000} s on a ${SIDE_FT} ft triangle. Ctrl+C to stop.`);
  setInterval(call, INTERVAL);
  setInterval(heartbeat, 5000);
  setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 15_000);
});
