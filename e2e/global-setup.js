import { execSync } from 'child_process';
import { startRelay } from './mock-relay.js';
import { startRelay as startNip29Relay } from './nip29-relay.js';
import { seedAllRelays, RELAY_URLS } from './seed-relays.js';
import { generateTestEvents } from './test-data.js';

const HANGING_RELAY_PORT = 19738;
const NIP29_RELAY_PORT = 17004;
const BLOSSOM_URL = 'http://localhost:13000';
const DEBUG = process.env.DEBUG;

/**
 * Wait for a relay to respond to NIP-11 requests
 * @param {string} wsUrl
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
async function waitForRelay(wsUrl, timeout = 30000) {
  const httpUrl = wsUrl.replace('ws://', 'http://');
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(httpUrl, {
        headers: { Accept: 'application/nostr+json' }
      });
      if (response.ok) {
        if (DEBUG) console.log(`[E2E Setup] ${wsUrl} is ready`);
        return true;
      }
    } catch {
      // Relay not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Relay ${wsUrl} not ready after ${timeout}ms`);
}

/**
 * Wait for Blossom server to respond
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
async function waitForBlossom(url, timeout = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        // 404 is OK - Blossom returns 404 for root path but server is ready
        if (DEBUG) console.log(`[E2E Setup] Blossom server is ready at ${url}`);
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Blossom server ${url} not ready after ${timeout}ms`);
}

/**
 * Start Docker Compose and wait for all relays and Blossom server
 * @returns {Promise<void>}
 */
async function startDockerCompose() {
  if (DEBUG) console.log('[E2E Setup] Starting Docker Compose...');

  // Start containers in detached mode (without --wait, we do our own health checks)
  execSync('docker compose -f e2e/docker-compose.e2e.yml up -d', {
    stdio: DEBUG ? 'inherit' : 'pipe',
    cwd: process.cwd()
  });

  // Wait for all relays to respond to NIP-11 and Blossom server to be ready
  // This is more reliable than --wait because we control the timeout
  await Promise.all([
    ...Object.values(RELAY_URLS).map((url) => waitForRelay(url)),
    waitForBlossom(BLOSSOM_URL)
  ]);

  if (DEBUG) console.log('[E2E Setup] All Docker services ready');
}

export default async function globalSetup() {
  // Start Docker Compose relays
  await startDockerCompose();

  // Seed test data to Docker relays
  await seedAllRelays();

  // Start hanging mock relay (for timedPool timeout tests)
  // This relay sends events but never EOSE for kind 30142
  const events = generateTestEvents();
  const hangingRelay = await startRelay(HANGING_RELAY_PORT, events, {
    hangEoseForKinds: [30142]
  });
  if (DEBUG)
    console.log(`[E2E Setup] Hanging relay running on ws://localhost:${HANGING_RELAY_PORT}`);

  globalThis.__HANGING_RELAY__ = hangingRelay;

  // Start in-process NIP-29 mock relay (moderated-lifecycle specs)
  const nip29Relay = await startNip29Relay(NIP29_RELAY_PORT);
  if (DEBUG) console.log(`[E2E Setup] NIP-29 relay running on ws://localhost:${NIP29_RELAY_PORT}`);

  globalThis.__NIP29_RELAY__ = nip29Relay;
}
