import { test, expect } from './fixtures.js';

test.describe('welcome screen', () => {
  test('shows the brand cover', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Serra Base Station');
    await expect(page.locator('#welcome')).toBeVisible();
    await expect(page.locator('#dashboard')).toBeHidden();
    await expect(page.locator('#welcome h1')).toHaveText('Off-grid search and rescue mesh');
  });

  test('Open base station plays the loading screen, then opens the dashboard', async ({ page }) => {
    await page.goto('/');
    await page.locator('#enter').click();
    const loader = page.locator('#loader');
    await expect(loader).toBeVisible();
    await expect(loader).toContainText('Joining Serranet');
    await expect(loader).toContainText('Serranet online', { timeout: 5_000 });
    await expect(page.locator('#dashboard')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(loader).toBeHidden({ timeout: 2_000 });
  });
});
