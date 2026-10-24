/**
 * Nostr Infrastructure - Core stores and pool
 * Relay configuration is managed via runtimeConfig (from .env)
 */
import { EventStore, DeleteManager } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
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
// explicit timeout passed by timedPool (loaders/base.js). No liveness source
// is configured: the app decides per surface which relays to skip.
export const pool = new RelayPool();
