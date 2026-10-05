/**
 * Live inputs for the connection status (helpers/connection-status.js):
 * the browser's online flag, the health of every relay in the pool and
 * signatures that keep us waiting. Started by the first status view that
 * mounts; runs for the rest of the session.
 */
import { combineLatest, of, timer } from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { getAppRelaysForCategory } from '$lib/services/app-relay-service.svelte.js';
import { subscribeSlowSigns } from '$lib/helpers/signer-wait.js';
import {
  coreHostsOf,
  deriveConnectionStatus,
  describeServers
} from '$lib/helpers/connection-status.js';

// A relay must keep failing this long before it counts: a socket that
// drops and reconnects within a second or two is not worth a warning.
const FAILING_GRACE_MS = 3_000;

let online = $state(true);
/** @type {Array<{url: string, failing: boolean, connected: boolean}>} */
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
  const failing$ = combineLatest([relay.connected$, relay.error$]).pipe(
    map(([connected, error]) => !connected && !!error),
    distinctUntilChanged(),
    switchMap((failing) => (failing ? timer(FAILING_GRACE_MS).pipe(map(() => true)) : of(false))),
    startWith(false),
    distinctUntilChanged()
  );
  return combineLatest([failing$, relay.connected$]).pipe(
    map(([failing, connected]) => ({ url: relay.url, failing, connected }))
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

function coreHosts() {
  return coreHostsOf({
    calendar: getAppRelaysForCategory('calendar'),
    communikey: getAppRelaysForCategory('communikey'),
    educational: getAppRelaysForCategory('educational'),
    longform: getAppRelaysForCategory('longform'),
    kanban: getAppRelaysForCategory('kanban'),
    groups: getGroupsRelays()
  });
}

/** @returns {ReturnType<typeof deriveConnectionStatus>} */
export function getConnectionStatus() {
  return deriveConnectionStatus({
    online,
    relays,
    coreHosts: coreHosts(),
    waitingForSigner: slowSigns > 0
  });
}

/** For the connection modal: the raw inputs plus every app server's state. */
export function getConnectionDetails() {
  return {
    online,
    waitingForSigner: slowSigns > 0,
    servers: describeServers({ relays, coreHosts: coreHosts() })
  };
}
