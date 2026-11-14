import { defineConfig, devices } from '@playwright/test';

process.env.VITE_GOOGLE_CLIENT_ID ??= 'playwright-test-client';
process.env.VITE_GOOGLE_API_KEY ??= 'playwright-test-api-key';
process.env.VITE_GOOGLE_APP_ID ??= '1234567890';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    locale: 'en-US',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ],
  webServer: {
    command: 'npm run dev -- --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
