import { defineConfig } from '@playwright/test';

// Docker relay ports - Using 17xxx range to avoid conflicts with other projects
const RELAY_URLS = {
  amb: 'ws://localhost:17001',
  calendar: 'ws://localhost:17002',
  strfry: 'ws://localhost:17003',
  hanging: 'ws://localhost:19738' // Mock relay for timedPool timeout tests
};

// Blossom server for file uploads
const BLOSSOM_SERVER_URL = 'http://localhost:13000';

// Web server port - Using 14173 to avoid conflicts with other projects
const WEB_SERVER_PORT = 14173;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.test.js',

  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',

  // Run test files in parallel across workers
  // Tests within each file still run sequentially (safe for create/modify flows)
  // Increased workers for better parallelization: 6 local, 8 CI
  workers: process.env.CI ? 8 : 6,

  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 1,
  reporter: 'html',

  use: {
    baseURL: `http://localhost:${WEB_SERVER_PORT}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry'
  },

  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.CHROMIUM_BIN || 'chromium'
        }
      }
    }
  ],

  webServer: {
    // --strictPort is load-bearing, not tidiness. Without it vite silently
    // binds the NEXT free port when this one is taken, while playwright goes on
    // waiting for WEB_SERVER_PORT — which is then somebody else's server. The
    // run does not crash; it tests another worktree's build and reports green
    // or red with nothing in the output naming which build answered. Both of us
    // hit that within one hour on 2026-08-07, in both directions. With the flag
    // the preview refuses to start and the failure is immediate and legible.
    command: `pnpm run build && pnpm run preview --port ${WEB_SERVER_PORT} --strictPort`,
    port: WEB_SERVER_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      CALENDAR_RELAYS: RELAY_URLS.calendar,
      COMMUNIKEY_RELAYS: RELAY_URLS.strfry,
      AMB_RELAYS: RELAY_URLS.amb,
      LONGFORM_CONTENT_RELAY: RELAY_URLS.strfry,
      FALLBACK_RELAYS: RELAY_URLS.strfry,
      RELAY_LIST_LOOKUP_RELAYS: RELAY_URLS.strfry,
      INDEXER_RELAYS: RELAY_URLS.strfry,
      BLOSSOM_SERVER_URL: BLOSSOM_SERVER_URL,
      CONCORD_ENABLED: 'true',
      CONCORD_RELAYS: RELAY_URLS.strfry,
      GATED_MODE_DEFAULT: 'true',
      GATED_MODE_FORCE: 'true',
      ORIGIN: `http://localhost:${WEB_SERVER_PORT}`,
      NODE_ENV: 'production',
      PORT: String(WEB_SERVER_PORT)
    }
  }
});
