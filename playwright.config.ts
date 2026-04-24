import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for podZAP E2E suite.
 *
 * Default baseURL is the local dev server (`npm run dev` on :3001). Override
 * via `PLAYWRIGHT_BASE_URL` to target prod (`https://podzap.wsmart.com.br`)
 * or any preview — but default runs stay local so CI / ad-hoc runs never
 * hit prod by accident.
 *
 * We intentionally do NOT configure `webServer` — dev server is started
 * manually (`npm run dev`) and Playwright attaches. This avoids double-
 * booting Next on every spec run and lets us keep Inngest dev + Supabase
 * CLI alive alongside.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/playwright-report', open: 'never' }],
  ],
  outputDir: 'e2e/test-results',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Enable if/when cross-browser becomes a requirement. WebKit in particular
    // is a decent smoke-check for Safari quirks (cookie SameSite, date parsing).
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
});
