// Playwright end-to-end tests for the dashboard mockup.
//   npm run test:e2e         headless, Chromium desktop + phone
//   npm run test:e2e:ui      interactive runner
// First time only: npx playwright install chromium

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Half the CPU cores and a generous timeout: the suite also runs inside the pre-push hook,
  // often while VS Code and Docker are busy, and 12 parallel browsers made slow machines flaky.
  workers: '50%',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /rescuer\.spec\.js/ },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
