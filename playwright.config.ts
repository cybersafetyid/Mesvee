import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration for Mesvee.
 *
 * The suite drives the real React shell against the **mock bridge**
 * (`npm run dev:web`, port 1420), so it exercises layout, copy, keyboard flows
 * and state transitions without needing a signed native build. Native-only
 * behaviour (real webviews, keychain, updater) is covered by the Rust suite.
 *
 * `reuseExistingServer` keeps a locally running dev server alive instead of
 * killing it and binding the port again.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:1420',
    // The shell ships Bahasa Indonesia as its default locale; assert against it.
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev:web',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});