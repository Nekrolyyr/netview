import { defineConfig } from '@playwright/test';

/** Smoke tests against the production build, in the installed Chrome (no browser download). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { channel: 'chrome', baseURL: 'http://localhost:4173', viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // same build, with a default bundle (tests/e2e/default.spec.ts)
      command: 'npm run preview -- --port 4174 --strictPort',
      url: 'http://localhost:4174',
      env: { NETVIEW_DATASET: 'tests/fixtures/synthetic.netview' },
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
