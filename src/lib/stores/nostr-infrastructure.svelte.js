/**
 * Nostr Infrastructure - Core stores and pool
 * Relay configuration is managed via runtimeConfig (from .env)
 */
import { EventStore, DeleteManager } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import { createRelayLiveness } from '$lib/stores/relay-liveness.js';
// Side-effect: registers CommentsModel, casts, and other mixins on EventStore
import 'applesauce-common';

// The DeleteManager is created here and exposed on the store so the persistent
// event cache can mirror NIP-09 deletions into IDB: kind 5 events go straight
// to the manager and never appear on `insert$`, and the store keeps its own
// reference private. Attached as a property (not a separate export) so the
// many tests that mock this module with a bare `eventStore` keep working.
const deleteManager = new DeleteManager();
export const eventStore = Object.assign(new EventStore({ deleteManager }), { deleteManager });

// Svelte 5 deep-proxies every object whose prototype is Object.prototype (or
// Array.prototype) when it lands in `$state`, and its proxy rejects the
// non-enumerable symbol properties applesauce memoizes onto events
// (`state_descriptors_fixed` — the whole route dies on the first helper call).
// Giving every stored event its own prototype makes it a non-plain object
// Svelte leaves alone, wherever a component ends up holding it. Nothing else
// changes: no own properties, JSON/spread/structuredClone/verifyEvent see the
// same event. `insert$` fires synchronously inside `add()`, and the store
// hands out its single instance per id, so consumers only ever see marked
// events. Events that never pass the store (direct relay reads) still need
// `$state.raw` — see state-raw-events.test.js.
export const NOSTR_EVENT_PROTOTYPE = Object.freeze(Object.create(Object.prototype));
eventStore.insert$.subscribe((event) => {
  if (Object.getPrototypeOf(event) === Object.prototype)
    Object.setPrototypeOf(event, NOSTR_EVENT_PROTOTYPE);
});
// v6: eoseTimeout was removed. Per-request completion is handled by
// group.request()'s default complete strategy (v7: completeAfterIdle) plus the
// explicit timeout passed by timedPool (loaders/base.js).
//
// Relay liveness (stores/relay-liveness.js): the tracker observes the pool's
// connections and parks relays that fail to connect, so a dead relay costs
// one request its timeout instead of every request. Pool-level request /
// subscription / sync skip parked relays; `pool.relay(url)` never does, which
// keeps publishing (publish-service) and the settings probe trying every
// listed relay. State is restored from localStorage in the browser; evidence
// collected while loading wins over stored state.
export const relayLiveness = createRelayLiveness();
if (typeof window !== 'undefined') {
  relayLiveness.load().catch((err) => console.warn('[relay-liveness] load failed:', err));
}
export const pool = new RelayPool({ liveness: relayLiveness });
