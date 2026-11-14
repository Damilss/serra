// Shared test setup: every test fails if the page throws an uncaught error or logs a console error.

import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      // Google Fonts may be unreachable offline; that's expected and not a page bug.
      if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url)) {
        errors.push(`console: ${m.text()}`);
      }
    });
    await use(page);
    expect(errors, 'page errors').toEqual([]);
  },
});

export { expect };

/** Opens the dashboard directly (skips the welcome screen). */
export async function openDashboard(page) {
  await page.goto('/#dashboard');
  await expect(page.locator('#dashboard')).toBeVisible();
}

/** Simulates a call at the selected node and waits until the alert reaches the base (~2–6 s). */
export async function simulateAndWait(page) {
  await page.locator('#sim-btn').click();
  await expect(page.locator('#map-tag')).toContainText(/incoming/i);
  await expect(page.locator('#alert-card')).toBeVisible({ timeout: 15_000 });
}
