import { defineConfig } from '@playwright/test';

// Docker relay ports - Using 17xxx range to avoid conflicts with other projects
const RELAY_URLS = {
  amb: 'ws://localhost:17001',
  calendar: 'ws://localhost:17002',
  strfry: 'ws://localhost:17003',
  groups: 'ws://localhost:17004', // In-process NIP-29 mock relay (moderated-lifecycle specs)
  hanging: 'ws://localhost:19738' // Mock relay for timedPool timeout tests
};

// Blossom server for file uploads
const BLOSSOM_SERVER_URL = 'http://localhost:13000';

// Web server port - Using 14173 to avoid conflicts with other projects.
// Overridable because the port was a hardcoded constant while
// `reuseExistingServer` is true outside CI: a preview server left running by
// another worktree on the same port gets *reused*, so the run silently
// exercises that worktree's build instead of this one. Set E2E_PORT to a free
// port when running two trees at once. Default unchanged.
const WEB_SERVER_PORT = Number(process.env.E2E_PORT) || 14173;

const CHROMIUM_BIN = process.env.CHROMIUM_BIN || 'chromium';
// A nix-store chromium carries a full RPATH and must not inherit
// LD_LIBRARY_PATH: the nixpkgs claude-code wrapper prefixes it with the
// system's alsa-lib (built against a newer glibc than the flake's chromium),
// and that libasound shadows chromium's own — the browser dies at launch with
// `GLIBC_ABI_GNU2_TLS' not found` for every e2e run started from a Claude
// session (measured 2026-10-26). Hand such a browser a clean one; any other
// executable keeps the inherited environment untouched.
const BROWSER_ENV = CHROMIUM_BIN.startsWith('/nix/store/')
  ? { ...process.env, LD_LIBRARY_PATH: '' }
  : process.env;

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
          executablePath: CHROMIUM_BIN,
          env: BROWSER_ENV,
          // Opt-in only: some hosts substitute a PNA-enforcing google-chrome
          // build for CHROMIUM_BIN (broken nix chromium), which blocks the
          // e2e mock relays' localhost WebSockets under Chrome's Local
          // Network Access policy and silently hangs relay-publish specs.
          // Set E2E_DISABLE_LNA_CHECKS=1 on those hosts only.
          args: process.env.E2E_DISABLE_LNA_CHECKS
            ? ['--disable-features=LocalNetworkAccessChecks']
            : []
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
    // `command` runs a full production build first, so this budget covers a
    // COLD build, not just server startup. 120s assumed a warm one and expired
    // before a single test ran in a freshly-installed worktree.
    timeout: 300_000,
    env: {
      CALENDAR_RELAYS: RELAY_URLS.calendar,
      COMMUNIKEY_RELAYS: RELAY_URLS.strfry,
      AMB_RELAYS: RELAY_URLS.amb,
      LONGFORM_CONTENT_RELAY: RELAY_URLS.strfry,
      FALLBACK_RELAYS: RELAY_URLS.strfry,
      RELAY_LIST_LOOKUP_RELAYS: RELAY_URLS.strfry,
      INDEXER_RELAYS: RELAY_URLS.strfry,
      // Every relay var the APP reads must be pinned here, or a populated local
      // .env leaks a production host into the sandbox — measured: an unpinned
      // KANBAN_RELAYS opened wss://relay-rpi.edufeed.org and issued a REQ for
      // the test user. Reads only, and CI without a .env is unaffected, but the
      // rule is the whole set, not the ones a current spec happens to exercise.
      // (EDUFEED_PUBLISH_RELAYS is deliberately absent: read by scripts/ operator
      // CLIs, never by the app, and the e2e never runs them.)
      KANBAN_RELAYS: RELAY_URLS.strfry,
      DM_RELAYS: RELAY_URLS.strfry,
      BLOSSOM_SERVER_URL: BLOSSOM_SERVER_URL,
      // New communities take their blossom tag from here; unpinned, a local
      // .env would put a production Blossom server into test communities.
      DEFAULT_BLOSSOM_SERVERS: BLOSSOM_SERVER_URL,
      CONCORD_ENABLED: 'true',
      CONCORD_RELAYS: RELAY_URLS.strfry,
      GROUPS_ENABLED: 'true',
      GROUPS_RELAYS: RELAY_URLS.groups,
      // The curated/WoT author set gates which authors the feeds show. Unpinned,
      // a local .env's production CURATED_PUBKEYS_SETS filtered the seeded test
      // authors out of /discover and every discover spec failed with no hint
      // why. Empty = curated mode off, as in CI without a .env.
      CURATED_PUBKEYS_SETS: '',
      CURATED_PUBKEYS: '',
      CURATED_PUBKEYS_SETS_CALENDAR: '',
      CURATED_PUBKEYS_SETS_COMMUNIKEY: '',
      CURATED_PUBKEYS_SETS_EDUCATIONAL: '',
      CURATED_PUBKEYS_SETS_LONGFORM: '',
      CURATED_PUBKEYS_SETS_KANBAN: '',
      CURATED_PUBKEYS_CALENDAR: '',
      CURATED_PUBKEYS_COMMUNIKEY: '',
      CURATED_PUBKEYS_EDUCATIONAL: '',
      CURATED_PUBKEYS_LONGFORM: '',
      CURATED_PUBKEYS_KANBAN: '',
      WOT_ENABLED: 'false',
      WOT_ANCHOR_PUBKEYS: '',
      GATED_MODE_DEFAULT: 'true',
      GATED_MODE_FORCE: 'true',
      ORIGIN: `http://localhost:${WEB_SERVER_PORT}`,
      NODE_ENV: 'production',
      PORT: String(WEB_SERVER_PORT)
    }
  }
});
