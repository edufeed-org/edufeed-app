/**
 * Relay liveness for the shared RelayPool (applesauce-relay `RelayLiveness`).
 *
 * The tracker watches the pool's connections and parks a relay that fails to
 * connect: an exponential cooldown (30 s → 5 min) after each failure, and a
 * one-hour "dead" cooldown once a streak of failures spans ten minutes while
 * other relays answer. A success at any time revives the relay; unknown
 * relays are always eligible.
 *
 * It is attached to the pool for OBSERVATION only — not as the pool's
 * `liveness` option, which would filter every pool-level request. That global
 * filter is wrong for this app: the v7 timeline loader asks relays one at a
 * time and reads an instantly-empty (skipped) page as "range exhausted", so a
 * 30 s hiccup at page open would retire a relay from the feed for the session;
 * `pool.group(relays)` filters once at creation, so a standing subscription
 * (inbox, DM gift wraps, chat) would never re-admit a relay that recovers; and
 * the confirmed-absence verdicts (kind 10002 / 10050) would read a skipped
 * indexer as "no list". Those loaders carry their own retry/backoff. The
 * tracker's verdict is applied explicitly where skipping is safe:
 * `skipParkedRelays` in `timedPool` (one-shot `fetchEvents`), and never for
 * every relay at once.
 *
 * Reachability is a property of this device's network, so the state lives in
 * localStorage (restored states are capped to the ordinary cooldown — a relay
 * can never be excluded indefinitely from stored evidence alone).
 */
import { RelayLiveness } from 'applesauce-relay';

export const RELAY_LIVENESS_STORAGE_PREFIX = 'relay-liveness:';

/**
 * @typedef {{ getItem: (k: string) => string | null, setItem: (k: string, v: string) => void }} StorageLike
 */

/**
 * JSON adapter over localStorage for RelayLiveness's `storage` option.
 * @param {StorageLike | null} [store] - defaults to window.localStorage; null (SSR) → undefined
 * @returns {import('applesauce-relay').LivenessStorage | undefined}
 */
export function createLivenessStorage(store = defaultStore()) {
  if (!store) return undefined;
  return {
    getItem(key) {
      try {
        const raw = store.getItem(RELAY_LIVENESS_STORAGE_PREFIX + key);
        return raw == null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        store.setItem(RELAY_LIVENESS_STORAGE_PREFIX + key, JSON.stringify(value));
      } catch {
        // quota / private mode — liveness is a convenience, not state
      }
    }
  };
}

/** @returns {StorageLike | null} */
function defaultStore() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The relays worth asking right now: `relays` minus the ones the tracker has
 * parked. Never empties the list — when every relay is parked the original
 * list is returned, since asking nobody can only be worse than trying (the
 * network may be back; the tracker clears streaks on online/foreground).
 * Without a tracker (tests mocking the infrastructure) it is the identity.
 *
 * @param {{ filter: (relays: string[]) => string[] } | null | undefined} liveness
 * @param {string[]} relays
 * @returns {string[]}
 */
export function skipParkedRelays(liveness, relays) {
  if (!liveness || typeof liveness.filter !== 'function' || relays.length === 0) return relays;
  const eligible = liveness.filter(relays);
  return eligible.length > 0 ? eligible : relays;
}

/**
 * The app's liveness tracker. `storage: null` disables persistence (tests).
 * @param {import('applesauce-relay').LivenessOptions & { storage?: import('applesauce-relay').LivenessStorage | null }} [options]
 * @returns {RelayLiveness}
 */
export function createRelayLiveness(options = {}) {
  const { storage, ...rest } = options;
  return new RelayLiveness({
    ...rest,
    storage: storage === undefined ? createLivenessStorage() : (storage ?? undefined)
  });
}

/**
 * The app-wide tracker. Lives here rather than in nostr-infrastructure so
 * modules that only need the verdict (loaders/base.js) can import it without
 * the pool — and so tests that mock the infrastructure module keep a real,
 * empty tracker instead of a missing export. nostr-infrastructure attaches it
 * to the pool and restores its state in the browser.
 */
export const relayLiveness = createRelayLiveness();
