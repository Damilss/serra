import { test, expect, openDashboard, simulateAndWait } from './fixtures.js';

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
  });

  test('lists the five Serranodes and shows the selected one in the panel', async ({ page }) => {
    const select = page.locator('#node-select');
    await expect(select.locator('option')).toHaveCount(5);

    await select.selectOption({ label: 'Serranode 05 · Ridge Camp' });
    await expect(page.locator('#p-name')).toHaveText('Ridge Camp');
    await expect(page.locator('#tag')).toHaveText('0x52C6');
    await expect(page.locator('#p-state')).toContainText(/low battery/i);
  });

  test('arrow buttons and keys step through the nodes', async ({ page }) => {
    const select = page.locator('#node-select');
    const start = await select.inputValue();
    await page.locator('#next').click();
    await expect(select).not.toHaveValue(start);
    await page.locator('#prev').click();
    await expect(select).toHaveValue(start);

    await page.locator('body').press('ArrowRight');
    await expect(select).not.toHaveValue(start);
  });

  test("the morning's alert is in the feed, resolved, in calibrated dB", async ({ page }) => {
    const first = page.locator('#feed li').first();
    await expect(first).toContainText('Resolved');
    await expect(first).toContainText('Ridge Camp');
    await expect(first).toContainText('89.8 dB');
    await expect(first).toContainText('Bird call, false positive');
    await expect(page.locator('#feed-count')).toHaveText('1 today');
  });

  test('simulated whistle: relays to the base, then acknowledge and resolve', async ({ page }) => {
    await simulateAndWait(page);

    const card = page.locator('#alert-card');
    await expect(page.locator('#ac-title')).toHaveText('Whistle heard');
    await expect(page.locator('#ac-text')).toContainText(/heard first and loudest/);
    await expect(page.locator('#ac-readings')).toContainText(/Loudness\s*89\.8 dB/);
    await expect(page.locator('#map-tag')).toContainText(/live/i);

    await page.locator('#ac-ack').click();
    await expect(page.locator('#ac-state')).toContainText('Acknowledged');
    await expect(page.locator('#ac-ack')).toBeHidden();

    await page.locator('#ac-resolve').click();
    await expect(card).toBeHidden();
    await expect(page.locator('#feed li').first()).toContainText('Resolved');
    await expect(page.locator('#feed-count')).toHaveText('2 today');
  });

  test('the class switch changes what is simulated', async ({ page }) => {
    await page.locator('.seg button[data-cls="scream"]').click();
    await expect(page.locator('.seg button[data-cls="scream"]')).toHaveAttribute('aria-pressed', 'true');
    await simulateAndWait(page);
    await expect(page.locator('#ac-title')).toHaveText('Scream heard');
    await expect(page.locator('#ac-readings')).toContainText(/Loudness\s*85\.8 dB/);
  });

  test('replay opens the scrubber for an alert', async ({ page }) => {
    await page.locator('#feed li').first().getByRole('button', { name: 'Replay' }).click();
    await expect(page.locator('#rp-title')).toBeVisible();
    await expect(page.locator('#rp-title')).toContainText('Ridge Camp');
    await expect(page.locator('#map-tag')).toContainText(/replay/i);
    await page.locator('#rp-exit').click();
    await expect(page.locator('#map-tag')).toContainText(/live/i);
  });
});
