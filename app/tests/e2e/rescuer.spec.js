// Phone width: the dashboard opens in rescuer mode (runs in the "phone" project and on desktop).

import { test, expect } from './fixtures.js';

test.use({ viewport: { width: 390, height: 844 } });

test('opens in rescuer mode, simulates a call and walks it to found', async ({ page }) => {
  await page.goto('/dashboard');
  const rescuer = page.locator('#rescuer');
  await expect(rescuer).toBeVisible();
  await expect(page.locator('#mode-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#node-select')).toBeHidden();

  await rescuer.getByRole('button', { name: /simulate a call/i }).click();
  await expect(rescuer).toContainText('Relaying');

  const ack = rescuer.getByRole('button', { name: 'Acknowledge' });
  await expect(ack).toBeVisible({ timeout: 15_000 });
  await expect(rescuer).toContainText(/heard|whistle|scream|help/i);
  await ack.click();

  await rescuer.getByRole('button', { name: 'Mark found' }).click();
  await expect(rescuer.getByRole('button', { name: /simulate a call/i })).toBeVisible();
});

test('the mode button switches back to the full dashboard', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('#rescuer')).toBeVisible();
  await page.locator('#mode-btn').click();
  await expect(page.locator('#rescuer')).toBeHidden();
  await expect(page.locator('#map')).toBeVisible();
});
