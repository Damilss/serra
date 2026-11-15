// Playwright end-to-end tests for the Next.js dashboard.
//   npm run test:e2e         builds the app, serves it on :3100, runs Chromium desktop + phone
//   npm run test:e2e:ui      interactive runner
// First time only: npx playwright install chromium
// While `npm run dev` is running on :3100 (PORT=3100), the tests reuse it instead of building.

import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

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
  // A production build, so the tests see what the base station will serve.
  webServer: {
    command: `npm run build && npx next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
