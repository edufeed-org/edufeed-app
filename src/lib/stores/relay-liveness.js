/**
 * Relay liveness for the shared RelayPool (applesauce-relay `RelayLiveness`).
 *
 * The tracker watches the pool's connections and parks a relay that fails to
 * connect: an exponential cooldown (30 s → 5 min) after each failure, and a
 * one-hour "dead" cooldown once a streak of failures spans ten minutes while
 * other relays answer. Every pool-level request, subscription and sync skips
 * parked relays; `pool.relay(url)` is never filtered, so publishes and the
 * settings probe still try every relay the user listed. A success at any time
 * revives the relay at once; unknown relays are always eligible.
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
