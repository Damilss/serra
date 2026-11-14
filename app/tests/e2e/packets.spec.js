// The packet view must show exactly the bytes the firmware sends (firmware/mesh/packet.h):
// magic 0x5E, little-endian fields, peak_level as an i16 in tenths of a dB.

import { test, expect, openDashboard } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await openDashboard(page);
});

test('ALERT packet decodes like the base-station decoder', async ({ page }) => {
  await page.locator('#pklog li', { hasText: 'ALERT' }).first().click();
  const decode = page.locator('#decode');
  await expect(decode).toContainText('ALERT');
  await expect(decode).toContainText('0x5E · Serranet');
  await expect(decode).toContainText('0x52C6 · N05 Ridge Camp');
  await expect(decode).toContainText('WHISTLE');
  await expect(decode).toContainText('158/255 · 0.62');
  await expect(decode).toContainText('898 · 89.8 dB');
  await expect(decode).toContainText('3 · distress pattern');
  await expect(page.locator('#pk-live')).toHaveText('Resume live');
});

test('ALERT bytes match the wire format', async ({ page }) => {
  const { fields } = await page.evaluate(() => {
    const p = window.serraMock.packets.find((x) => x.kind === 'alert');
    return { fields: p.fields.map((f) => ({ name: f.name, bytes: f.bytes })) };
  });
  const by = Object.fromEntries(fields.map((f) => [f.name, f.bytes]));

  // header: magic, src 0x52C6 (LE), dst broadcast, ttl 0 after 4 hops, type ALERT
  expect(by.magic).toEqual([0x5e]);
  expect(by.src).toEqual([0xc6, 0x52]);
  expect(by.dst).toEqual([0xff, 0xff]);
  expect(by.ttl).toEqual([0]);
  expect(by.type).toEqual([1]);
  // payload: class 1 whistle, confidence 0.62 * 255 = 158, peak 898 = 0x0382 (LE), 3 blasts
  expect(by.class_id).toEqual([1]);
  expect(by.confidence).toEqual([158]);
  expect(by.peak_level).toEqual([0x82, 0x03]);
  expect(by.blast_count).toEqual([3]);

  // 9-byte header + 9-byte payload, as the firmware's static_asserts require
  const hdr = ['magic', 'src', 'dst', 'msg_id', 'ttl', 'type'].reduce((n, k) => n + by[k].length, 0);
  const pl = ['class_id', 'confidence', 'peak_level', 'timestamp', 'blast_count'].reduce(
    (n, k) => n + by[k].length,
    0,
  );
  expect(hdr).toBe(9);
  expect(pl).toBe(9);
});

test('clicking Resume live goes back to following new packets', async ({ page }) => {
  await page.locator('#pklog li').nth(2).click();
  await expect(page.locator('#pk-live')).toHaveText('Resume live');
  await page.locator('#pk-live').click();
  await expect(page.locator('#pk-live')).toHaveText('Following live');
});
