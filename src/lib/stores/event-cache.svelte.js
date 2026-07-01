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
 *
 * `undefined` in environments without IndexedDB (SSR/Node) so the module is
 * import-safe during SvelteKit prerender. All exported functions early-return
 * a graceful fallback when the singleton is unavailable.
 */
export const nostrIDB =
  typeof indexedDB !== 'undefined'
    ? new NostrIDB(undefined, {
        cacheIndexes: 1000,
        batchWrite: 100,
        writeInterval: 200,
        maxEvents: 20_000
      })
    : undefined;

/**
 * Resolves when the cache is ready to accept reads and writes.
 * If IDB fails to open, resolves anyway — the app continues network-only.
 */
export const dbReady = (async () => {
  if (!nostrIDB) return; // SSR / no-IDB environment — silent no-op
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

/**
 * Loader cache-request function. Returns events matching the filters from IDB.
 * Degrades to [] on any failure.
 *
 * @param {import('nostr-tools').Filter[]} filters
 * @returns {Promise<import('nostr-tools').Event[]>}
 */
export async function cacheRequest(filters) {
  if (!nostrIDB) return [];
  try {
    await dbReady;
    return await nostrIDB.query(filters);
  } catch (err) {
    console.warn('[event-cache] cacheRequest failed', err);
    return [];
  }
}

/**
 * Persist a NIP-09 deletion (kind 5) event to IDB.
 *
 * The EventStore routes kind 5 events straight to its DeleteManager and never
 * emits them on `insert$`, so the `persistEventsToCache` write pipeline (which
 * only listens to `insert$`) never sees them. Without this, a deletion filters
 * its target in-memory but is gone on the next reload — the still-cached
 * original is read back and the "deleted" content reappears. Deletion helpers
 * call this right after `eventStore.add(deletion)` so `hydrateDeletions()` can
 * replay it on the next boot. Degrades to a no-op on any failure.
 *
 * @param {import('nostr-tools').Event} event - A signed kind 5 deletion event.
 * @returns {Promise<void>}
 */
export async function cacheDeletion(event) {
  if (!nostrIDB) return;
  try {
    await dbReady;
    await nostrIDB.add(event);
  } catch (err) {
    console.warn('[event-cache] cacheDeletion failed', err);
  }
}

/**
 * Replay cached NIP-09 deletion events (kind 5) into the event store on boot.
 *
 * nostr-idb has no deletion semantics — it stores events blindly, so the
 * deleted content event survives in IDB. The applesauce EventStore filters
 * deleted events only for deletions it knows about (its DeleteManager). On a
 * fresh reload the store starts empty, so without replaying the cached kind 5
 * events the content loaders read deleted events back from cache and they
 * reappear. Loading the deletions first means any deleted event subsequently
 * added (from cache or network) is rejected / removed by the store.
 *
 * @returns {Promise<void>}
 */
export async function hydrateDeletions() {
  if (!nostrIDB) return;
  try {
    await dbReady;
    const deletions = await nostrIDB.query([{ kinds: [5] }]);
    for (const event of deletions) {
      eventStore.add(event);
    }
  } catch (err) {
    console.warn('[event-cache] hydrateDeletions failed', err);
  }
}

/**
 * Total number of events currently in the cache.
 *
 * nostr-idb's getIdsForFilter throws on a fully-empty filter `{}`, so we
 * enumerate cacheable kinds. Uses query() (not count()) so events still in
 * nostr-idb's write queue are included.
 *
 * @returns {Promise<number>}
 */
export async function count() {
  if (!nostrIDB) return 0;
  try {
    await dbReady;
    const events = await nostrIDB.query([{ kinds: Array.from(CACHEABLE_KINDS) }]);
    return events.length;
  } catch (err) {
    console.warn('[event-cache] count failed', err);
    return 0;
  }
}

/**
 * Drop all events from the cache. EventStore memory is untouched.
 *
 * deleteAllEvents() empties the IDB store + indexCache + eventMap, but does
 * NOT drain nostr-idb's pending write queue. We clear the queue too so that
 * any events added since the last flush don't reappear on the next query.
 *
 * @returns {Promise<void>}
 */
export async function clear() {
  if (!nostrIDB) return;
  try {
    await dbReady;
    nostrIDB.writeQueue?.clear?.();
    await nostrIDB.deleteAllEvents();
  } catch (err) {
    console.warn('[event-cache] clear failed', err);
  }
}

/**
 * Eagerly hydrate the event store with identity-related events for the
 * active user on boot. See spec §"Lifecycle / Identity warm-up".
 *
 * Reads own kind 3, 10002, 30002, 30000 from IDB, then reads kind 0 for
 * every pubkey p-tagged in the user's kind 3 contact list.
 *
 * No-op when activeUserPubkey is null/undefined (anonymous browsing).
 *
 * @param {{ activeUserPubkey: string | null | undefined }} opts
 * @returns {Promise<void>}
 */
export async function warmIdentity({ activeUserPubkey }) {
  if (!activeUserPubkey) return;
  if (!nostrIDB) return;
  try {
    await dbReady;

    // Step 1: load own identity events
    const ownEvents = await nostrIDB.query([
      { kinds: [3, 10002, 30002, 30000], authors: [activeUserPubkey] }
    ]);
    for (const event of ownEvents) {
      eventStore.add(event);
    }

    // Step 2: extract friend pubkeys from kind 3 contact list
    const contactList = ownEvents.find((e) => e.kind === 3);
    if (!contactList) return;
    const friendPubkeys = contactList.tags
      .filter((t) => t[0] === 'p' && typeof t[1] === 'string')
      .map((t) => t[1]);
    if (friendPubkeys.length === 0) return;

    // Step 3: bulk-load friend profiles (kind 0)
    const profiles = await nostrIDB.query([{ kinds: [0], authors: friendPubkeys }]);
    for (const profile of profiles) {
      eventStore.add(profile);
    }
  } catch (err) {
    console.warn('[event-cache] warmIdentity failed', err);
  }
}
