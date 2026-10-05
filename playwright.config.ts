// Browser tests (spec work item 6): a production build on an iPhone-sized
// WebKit, with the backend and third parties stubbed per test. CI runs them
// in the `e2e` job; locally: npm run build && npm run test:e2e
// (needs `npx playwright install webkit` once, ~100 MB).
//
// E2E_BASE_URL points the HTTP checks and B1 at a deployed preview instead
// (the weekly workflow does this).
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: remote ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Vercel previews sit behind Deployment Protection; its automation
    // bypass secret lets the weekly run in.
    extraHTTPHeaders: process.env.VERCEL_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS_SECRET, 'x-vercel-set-bypass-cookie': 'true' }
      : undefined,
  },
  projects: [{ name: 'iphone-webkit', use: { ...devices['iPhone 15'] } }],
  webServer: remote
    ? undefined
    : {
        command: `npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}/start`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
