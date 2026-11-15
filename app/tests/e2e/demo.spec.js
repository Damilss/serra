// Venue demo (/demo): three nodes on a taped triangle. Detect-only: a call is heard, classified on
// the node, flooded across the mesh and received at the base station, but not located.

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

test('a simulated call is heard, classified, flooded and received', async ({ page }) => {
  await page.locator('[data-mark="X1"]').click();
  await expect(page.locator('#venue-stage')).toContainText('Received at the base station', {
    timeout: 5_000,
  });
  await expect(page.locator('#venue-steps li[data-state="done"]')).toHaveCount(4);
  await expect(page.locator('#venue-result .venue-title')).toContainText('Whistle');
  await expect(page.locator('#venue-log li')).toHaveCount(1);
});

test('the steps play out in order: heard, classified, then received', async ({ page }) => {
  // a call at the far mark takes a moment for the sound to reach every node
  await page.locator('[data-mark="X4"]').click();
  await expect(page.locator('#venue-steps li[data-step="heard"]')).toHaveAttribute('data-state', 'done', {
    timeout: 5_000,
  });
  await expect(page.locator('#venue-steps li[data-step="classified"]')).toHaveAttribute(
    'data-state',
    'done',
    {
      timeout: 5_000,
    },
  );
  await expect(page.locator('#venue-steps li[data-step="received"]')).toHaveAttribute('data-state', 'done', {
    timeout: 5_000,
  });
});

test('each node reports its class, confidence and hops', async ({ page }) => {
  await page.locator('[data-mark="X1"]').click();
  await expect(page.locator('#venue-stage')).toContainText('Received at the base station', {
    timeout: 5_000,
  });
  const rows = page.locator('#venue-result .venue-readings tbody tr');
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(rows.nth(i)).toContainText('whistle');
    await expect(rows.nth(i)).toContainText('%');
    await expect(rows.nth(i)).toContainText(/direct|hop/);
  }
});

test('calls are not located on the floor', async ({ page }) => {
  await page.locator('[data-mark="X2"]').click();
  await expect(page.locator('#venue-stage')).toContainText('Received at the base station', {
    timeout: 5_000,
  });
  await expect(page.locator('#venue-est')).toHaveCount(0);
  await expect(page.locator('#venue-radius')).toHaveCount(0);
  const c = await page.evaluate(() => window.serraVenue.calls[0]);
  expect(c.fix).toBeUndefined();
});

test('clicking the floor simulates a call there', async ({ page }) => {
  const box = await page.locator('#venue-map canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#venue-log li')).toHaveCount(1);
  await expect(page.locator('#venue-stage')).toContainText('Received at the base station', {
    timeout: 5_000,
  });
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
