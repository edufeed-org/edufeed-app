import { execSync } from 'child_process';
import { stopRelay } from './mock-relay.js';

const DEBUG = process.env.DEBUG;

export default async function globalTeardown() {
  // Stop hanging mock relay
  if (globalThis.__HANGING_RELAY__) {
    await stopRelay(globalThis.__HANGING_RELAY__);
    if (DEBUG) console.log('[E2E Teardown] Hanging relay stopped');
  }

  // Stop NIP-29 mock relay (same {server, wss} shape as mock-relay.js)
  if (globalThis.__NIP29_RELAY__) {
    await stopRelay(globalThis.__NIP29_RELAY__);
    if (DEBUG) console.log('[E2E Teardown] NIP-29 relay stopped');
  }

  // Stop Docker Compose and remove volumes for clean state
  if (DEBUG) console.log('[E2E Teardown] Stopping Docker Compose...');
  try {
    execSync('docker compose -f e2e/docker-compose.e2e.yml down --volumes', {
      stdio: DEBUG ? 'inherit' : 'pipe',
      cwd: process.cwd()
    });
    if (DEBUG) console.log('[E2E Teardown] Docker containers stopped');
  } catch (err) {
    console.error('[E2E Teardown] Failed to stop Docker Compose:', err.message);
  }
}
