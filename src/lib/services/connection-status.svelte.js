/**
 * Live inputs for the connection status (helpers/connection-status.js):
 * the browser's online flag, the health of every relay in the pool and
 * signatures that keep us waiting. Started by the first status view that
 * mounts; runs for the rest of the session.
 */
import { combineLatest, of, timer } from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { getAppManagedRelays, getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { subscribeSlowSigns } from '$lib/helpers/signer-wait.js';
import { coreHostsOf, deriveConnectionStatus } from '$lib/helpers/connection-status.js';

// A relay must keep failing this long before it counts: a socket that
// drops and reconnects within a second or two is not worth a warning.
const FAILING_GRACE_MS = 3_000;

let online = $state(true);
/** @type {Array<{url: string, failing: boolean}>} */
let relays = $state.raw([]);
let slowSigns = $state(0);
let started = false;

/**
 * A relay is failing when it is not connected AND its last close or
 * connect attempt was an error. A socket applesauce closed because nothing
 * used it any more (keepAlive) closes cleanly and has no error.
 * @param {import('applesauce-relay').Relay} relay
 */
function relayHealth$(relay) {
  return combineLatest([relay.connected$, relay.error$]).pipe(
    map(([connected, error]) => !connected && !!error),
    distinctUntilChanged(),
    switchMap((failing) => (failing ? timer(FAILING_GRACE_MS).pipe(map(() => true)) : of(false))),
    startWith(false),
    distinctUntilChanged(),
    map((failing) => ({ url: relay.url, failing }))
  );
}

/** Idempotent; a no-op outside the browser. */
export function startConnectionStatus() {
  if (started || typeof window === 'undefined') return;
  started = true;

  online = navigator.onLine;
  window.addEventListener('online', () => (online = true));
  window.addEventListener('offline', () => (online = false));

  pool.relays$
    .pipe(
      switchMap((map) => {
        const list = [...map.values()];
        return list.length ? combineLatest(list.map(relayHealth$)) : of([]);
      })
    )
    .subscribe((health) => (relays = health));

  subscribeSlowSigns((count) => (slowSigns = count));
}

/** @returns {ReturnType<typeof deriveConnectionStatus>} */
export function getConnectionStatus() {
  const coreHosts = coreHostsOf([...getAppManagedRelays(), ...getGroupsRelays()]);
  return deriveConnectionStatus({
    online,
    relays,
    coreHosts,
    waitingForSigner: slowSigns > 0
  });
}
