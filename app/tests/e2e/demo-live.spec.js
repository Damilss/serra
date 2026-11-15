// Venue demo (/demo) fed live by the base-station decoder. Each test runs its own small stand-in for
// serra-base (GET /events as SSE, GET /health, CORS open) and pushes packets shaped exactly like the
// decoder's (base-station/README.md, "Output: event stream").

import http from 'node:http';
import { test, expect } from './fixtures.js';

const FT = 0.3048;

async function startDecoder() {
  const clients = new Set();
  let seq = 0;
  let t = 1_000_000;
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.url.startsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (req.url.startsWith('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      res.end(
        JSON.stringify({
          version: 'test',
          run_id: 'abc123',
          source: 'ble',
          scanner: 'up',
          uptime_s: 1,
          clients: clients.size,
          counts: { packets: seq },
        }),
      );
    } else res.writeHead(404, cors).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;

  /** One ALERT from node `src` at `peak` tenths of a dB, `dt` ms of Pi time after the last one. */
  const alert = (src, peak, cls = 'whistle', dt = 100) => {
    seq++;
    t += dt;
    const e = {
      run_id: 'abc123',
      seq,
      t_ms: t,
      rssi: -60,
      raw: '5e',
      magic: 94,
      src,
      dst: 65535,
      msg_id: seq,
      ttl: 4,
      hops: 0,
      type: 'ALERT',
      alert: {
        class: cls,
        confidence: 0.9,
        peak_level: peak,
        peak_db: peak / 10,
        timestamp: t,
        blast_count: 3,
      },
    };
    const frame = `id: abc123:${seq}\nevent: packet\ndata: ${JSON.stringify(e)}\n\n`;
    for (const c of clients) c.write(frame);
  };
  /** Moves Pi time on, so the next alert starts a new call. */
  const later = () => (t += 10_000);
  const close = () =>
    new Promise((r) => {
      for (const c of clients) c.destroy();
      server.close(r);
    });
  return { url, alert, later, close, clients };
}

/** Levels the three corners would hear from a call at mark `label`, tenths of a dB. */
async function levelsAt(page, label) {
  return page.evaluate((label) => {
    const { nodes, marks } = window.serraVenue.layout;
    const m = marks.find((x) => x.label === label);
    return nodes.map((n) => Math.round((100 - 20 * Math.log10(Math.hypot(n.x - m.x, n.y - m.y))) * 10));
  }, label);
}

let dec;
test.beforeEach(async ({ page }) => {
  dec = await startDecoder();
  await page.goto(`/demo?decoder=${encodeURIComponent(dec.url)}`);
  await expect(page.locator('#venue-link')).toContainText('Live');
  await expect(page.locator('#venue-chip')).toContainText('live');
});
test.afterEach(async () => {
  await dec.close();
});

test('three nodes reporting a whistle are located on the floor', async ({ page }) => {
  await expect(page.locator('#venue-health')).toContainText('source ble');
  const ids = [0x1c4e, 0x2a10, 0x3b7f];
  const peaks = await levelsAt(page, 'X2');
  ids.forEach((id, i) => dec.alert(id, peaks[i]));
  // X2 sits near node A, where three readings can fit a second spot too: either verdict is fine
  await expect(page.locator('#venue-result')).toContainText(/Call located|Two possible spots/, {
    timeout: 5_000,
  });
  await expect(page.locator('#venue-source')).toHaveText('Live · Whistle');
  await expect(page.locator('#venue-log li[data-source="live"]')).toHaveCount(1);

  const off = await page.evaluate(() => {
    const c = window.serraVenue.calls[0];
    const m = window.serraVenue.layout.marks.find((x) => x.label === 'X2');
    return Math.hypot(c.fix.x - m.x, c.fix.y - m.y);
  });
  expect(off / FT).toBeLessThan(1.5);
});

test('new Serranodes fill the corners in the order they are first heard', async ({ page }) => {
  const peaks = await levelsAt(page, 'X1');
  [0x0b16, 0x0c01, 0x0d02].forEach((id, i) => dec.alert(id, peaks[i]));
  await expect(page.locator('#venue-result')).toContainText('Call located', { timeout: 5_000 });
  await expect(page.getByLabel('Node at corner A')).toHaveValue(String(0x0b16));
  await expect(page.getByLabel('Node at corner B')).toHaveValue(String(0x0c01));
  await expect(page.getByLabel('Node at corner C')).toHaveValue(String(0x0d02));
});

test('alerts more than 2 s apart are separate calls, and a call two nodes missed is not located', async ({
  page,
}) => {
  const peaks = await levelsAt(page, 'X1');
  dec.alert(0x1c4e, peaks[0], 'scream');
  dec.later();
  dec.alert(0x2a10, peaks[1], 'scream');
  await expect(page.locator('#venue-log li')).toHaveCount(2, { timeout: 6_000 });
  await expect(page.locator('#venue-result')).toContainText('Heard by B only', { timeout: 5_000 });
  await expect(page.locator('#venue-partial')).toContainText('near node B');
  await expect(page.locator('#venue-source')).toHaveText('Live · Scream');
});

test('calibrating at the centre evens out the microphones', async ({ page }) => {
  const ids = [0x1c4e, 0x2a10, 0x3b7f];
  const skew = [0, 30, -20]; // B reads 3 dB hot, C 2 dB quiet
  const peaks = await levelsAt(page, 'X1');
  ids.forEach((id, i) => dec.alert(id, peaks[i] + skew[i]));
  await expect(page.locator('#venue-result')).toContainText(/Call located|Two possible spots/, {
    timeout: 5_000,
  });
  await page.locator('#venue-calibrate').click();
  await expect(page.getByText('Calibrated from the last live call.')).toBeVisible();
  const offsets = await page.locator('#venue-nodes tbody tr td:last-child').allTextContents();
  expect(offsets).toEqual(['+0.3 dB', '-2.7 dB', '+2.3 dB']);

  // the same uneven microphones, now from mark X2: calibrated, it lands on X2
  dec.later();
  const p2 = await levelsAt(page, 'X2');
  ids.forEach((id, i) => dec.alert(id, p2[i] + skew[i]));
  await expect(page.locator('#venue-log li')).toHaveCount(2, { timeout: 5_000 });
  const off = await page.evaluate(() => {
    const c = window.serraVenue.calls[0];
    const m = window.serraVenue.layout.marks.find((x) => x.label === 'X2');
    return Math.hypot(c.fix.x - m.x, c.fix.y - m.y);
  });
  expect(off / FT).toBeLessThan(1.5);
});

test('disconnecting goes back to simulated calls', async ({ page }) => {
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.locator('#venue-link')).toContainText('Off');
  await expect(page.locator('#venue-chip')).toContainText('simulated');
  await expect.poll(() => dec.clients.size).toBe(0);
});
