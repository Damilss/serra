// The mockup's sound model must stay consistent with the wire format and with physics:
// peak_level in tenths of a dB (i16), every reported level above the wake trigger, the calling
// node loudest, and levels falling with distance.

import { test, expect, openDashboard } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await openDashboard(page);
});

test('every simulated reading is valid peak_level and above the wake trigger', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { makeAlert, TRIGGER_DB } = window.serraMock;
    const alerts = [];
    for (const cls of ['whistle', 'scream', 'help']) {
      for (let src = 1; src <= 5; src++) alerts.push({ cls, src, a: makeAlert(src, { cls }) });
    }
    return {
      TRIGGER_DB,
      alerts: alerts.map(({ cls, src, a }) => ({
        cls,
        src,
        heard: a.heard.map((h) => ({ i: h.i, d: h.d, peak: h.peak })),
      })),
    };
  });

  for (const { src, heard } of result.alerts) {
    expect(heard[0].i, 'the calling node is heard first and loudest').toBe(src);
    for (const h of heard) {
      expect(Number.isInteger(h.peak)).toBe(true);
      expect(h.peak).toBeGreaterThanOrEqual(result.TRIGGER_DB * 10);
      expect(h.peak).toBeLessThanOrEqual(32767); // fits an int16
      expect(h.peak / 10).toBeLessThan(120); // plausible calibrated dB
    }
    // farther nodes hear it quieter (allowing the ±1 dB jitter)
    const byDistance = [...heard].sort((a, b) => a.d - b.d);
    for (let k = 1; k < byDistance.length; k++) {
      if (byDistance[k].d - byDistance[k - 1].d > 50) {
        expect(byDistance[k].peak).toBeLessThan(byDistance[k - 1].peak + 20);
      }
    }
  }
});

test('inverse-square falloff: about 6 dB less per doubling of distance', async ({ page }) => {
  const { at100, at200, at400 } = await page.evaluate(() => {
    const { levelAt } = window.serraMock;
    return { at100: levelAt('whistle', 100), at200: levelAt('whistle', 200), at400: levelAt('whistle', 400) };
  });
  // 20·log10(2) ≈ 6.02 dB plus 0.01 dB/m absorption over the extra distance
  expect(at100 - at200).toBeCloseTo(6.02 + 1, 1);
  expect(at200 - at400).toBeCloseTo(6.02 + 2, 1);
});

test('quieter calls are confirmed by fewer nodes', async ({ page }) => {
  const counts = await page.evaluate(() => {
    const { makeAlert } = window.serraMock;
    const n = (cls) => [1, 2, 3, 4, 5].reduce((s, src) => s + makeAlert(src, { cls }).heard.length, 0);
    return { whistle: n('whistle'), help: n('help') };
  });
  expect(counts.help).toBeLessThan(counts.whistle);
});
