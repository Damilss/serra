// Venue demo (/demo): three nodes on a taped triangle, calls located by loudness trilateration.

import { test, expect } from './fixtures.js';

const FT = 0.3048;

test.beforeEach(async ({ page }) => {
  await page.goto('/demo');
  await expect(page.locator('#venue')).toBeVisible();
});

test('tabs switch between the field dashboard and the venue demo', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'View' });
  await expect(nav.getByRole('link', { name: 'Venue demo' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Field' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('#map')).toBeVisible();
  await page.getByRole('navigation', { name: 'View' }).getByRole('link', { name: 'Venue demo' }).click();
  await expect(page).toHaveURL(/\/demo$/);
});

test('the triangle is 20 ft on each side', async ({ page }) => {
  const sides = await page.evaluate(() => {
    const n = window.serraVenue.layout.nodes;
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    return [d(n[0], n[1]), d(n[1], n[2]), d(n[2], n[0])];
  });
  for (const s of sides) expect(s / FT).toBeCloseTo(20, 5);
});

test('a call at the centre mark is located within a few feet', async ({ page }) => {
  await page.locator('[data-mark="X1"]').click();
  await expect(page.locator('#venue-result')).toContainText('Call located', { timeout: 5_000 });
  const off = parseFloat(await page.locator('#venue-off').textContent());
  expect(off).toBeLessThan(3);
  await expect(page.locator('#venue-log li')).toHaveCount(1);
});

test('every mark inside the triangle is located within 3 ft, without noise', async ({ page }) => {
  await page.getByLabel('Measurement noise').selectOption('0');
  const offs = await page.evaluate(async () => {
    const results = [];
    for (const label of ['X1', 'X2', 'X3']) {
      document.querySelector(`[data-mark="${label}"]`).click();
      await new Promise((r) => setTimeout(r, 50));
      const c = window.serraVenue.calls[0];
      results.push(Math.hypot(c.truth.x - c.fix.x, c.truth.y - c.fix.y));
    }
    return results;
  });
  for (const m of offs) expect(m / FT).toBeLessThan(3);
});

test('a call outside the triangle is flagged as two possible spots', async ({ page }) => {
  await page.getByLabel('Measurement noise').selectOption('0');
  await page.locator('[data-mark="X4"]').click();
  await expect(page.locator('#venue-result')).toContainText('Two possible spots', { timeout: 5_000 });
  await expect(page.locator('#venue-ambiguous')).toBeVisible();
});

test('clicking the floor simulates a call there', async ({ page }) => {
  const box = await page.locator('#venue-map canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#venue-log li')).toHaveCount(1);
  await expect(page.locator('#venue-result')).toContainText('Call located', { timeout: 5_000 });
});

test('the triangle size can be changed, and bad input is rejected', async ({ page }) => {
  const input = page.getByLabel('Triangle side (ft)');
  await input.fill('abc');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Enter a side length between 5 and 200 ft.')).toBeVisible();
  await input.fill('30');
  await page.getByRole('button', { name: 'Apply' }).click();
  const side = await page.evaluate(() => window.serraVenue.layout.sideFt);
  expect(side).toBe(30);
});
