/**
 * Persistent event cache backed by nostr-idb (IndexedDB).
 * See docs/superpowers/specs/2026-04-24-persistent-event-cache-design.md
 *
 * The cache is ADDITIVE — if IDB fails to open or read, the app degrades
 * gracefully to network-only behavior (console.warn, no user-visible error).
 */

import { NostrIDB } from 'nostr-idb';
import { persistEventsToCache } from 'applesauce-core/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * Kinds we persist to IDB. See spec §"What gets persisted" for rationale.
 * Write filter applied inside persistEventsToCache's writer callback.
 */
const CACHEABLE_KINDS = new Set([
  0, // profiles
  3, // contact lists
  5, // NIP-09 deletions (required for correctness)
  10002, // NIP-65 relay lists
  10222, // community definitions
  30000, // follow sets (d=communities et al)
  30002, // app relay overrides
  30023, // long-form articles
  30142, // AMB educational resources
  31922, // date-based calendar events
  31923, // time-based calendar events
  31924 // calendars
]);

/**
 * @param {number} kind
 * @returns {boolean}
 */
export function isCacheableKind(kind) {
  return CACHEABLE_KINDS.has(kind);
}

/**
 * Singleton NostrIDB instance (exported for testability).
 * NostrIDB constructor signature is `(db?, opts?)` — we pass `undefined` for the
 * first arg so it opens the default IDB database itself.
 */
export const nostrIDB = new NostrIDB(undefined, {
  cacheIndexes: 1000,
  batchWrite: 100,
  writeInterval: 200,
  maxEvents: 20_000
});

/**
 * Resolves when the cache is ready to accept reads and writes.
 * If IDB fails to open, resolves anyway — the app continues network-only.
 */
export const dbReady = (async () => {
  try {
    await nostrIDB.start();
    // Wire write-side: persistEventsToCache batches new events from the
    // event store into the writer callback. We filter inside the callback.
    // Use a 1s batch window so tests and the UI both flush quickly.
    persistEventsToCache(
      eventStore,
      async (events) => {
        const cacheable = events.filter((e) => CACHEABLE_KINDS.has(e.kind));
        if (cacheable.length === 0) return;
        await Promise.allSettled(cacheable.map((e) => nostrIDB.add(e)));
      },
      { batchTime: 1_000 }
    );
  } catch (err) {
    console.warn('[event-cache] IDB open failed; running network-only', err);
  }
})();
