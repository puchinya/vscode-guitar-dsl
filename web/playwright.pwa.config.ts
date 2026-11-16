import { defineConfig, devices } from '@playwright/test';

process.env.VITE_GOOGLE_CLIENT_ID ??= 'playwright-test-client';
process.env.VITE_GOOGLE_API_KEY ??= 'playwright-test-api-key';
process.env.VITE_GOOGLE_APP_ID ??= '1234567890';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: '**/pwa-production.spec.ts',
  fullyParallel: false,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:4179',
    locale: 'en-US',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium-production-pwa', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'npm run build && node scripts/pwa-test-server.mjs',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
