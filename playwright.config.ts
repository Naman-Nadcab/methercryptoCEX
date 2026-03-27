import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: process.env.CI ? 'list' : 'html',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // Use system Chrome (avoids sandbox path issues with bundled Chromium in Cursor/CI)
      channel: 'chrome',
    },
  }],
  // Use SKIP_WEBSERVER=1 when servers are already running. Otherwise Playwright starts them.
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev:fb',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
