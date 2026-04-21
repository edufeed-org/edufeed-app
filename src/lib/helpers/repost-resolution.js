/**
 * Shared repost resolution utilities.
 *
 * Extracts the repost reference resolution pattern used by both community content
 * loaders and the follows feed. Uses applesauce helpers instead of manual tag parsing.
 */
import { tap } from 'rxjs';
import {
  getEmbededSharedEvent,
  getSharedEventPointer,
  getSharedAddressPointer
} from 'applesauce-common/helpers';

/**
 * Fetch events by IDs using a one-shot pool.request().
 * Unlike singleton loaders (eventLoader/addressLoader), this bypasses deduplication
 * caches — critical when relay connections may not be ready during early requests.
 *
 * @param {string[]} ids
 * @param {string[]} relays
 * @param {{ pool: any, eventStore: any }} deps
 * @returns {import('rxjs').Subscription | undefined}
 */
export function fetchEventsByIds(ids, relays, { pool, eventStore }) {
  if (ids.length === 0) return;
  return pool
    .request(relays, [{ ids }], /** @type {any} */ ({ timeout: 5000 }))
    .pipe(tap((event) => eventStore.add(event)))
    .subscribe();
}

/**
 * Resolve repost target references: extract embedded events, fetch by ID/address.
 *
 * For each repost event:
 * 1. Try to extract the embedded event from content → add to eventStore immediately
 * 2. Collect e-tag IDs for batch fetch
 * 3. Resolve a-tag address pointers via addressLoader
 *
 * @param {any[]} repostEvents - Kind 6/16 repost events
 * @param {Object} deps
 * @param {any} deps.eventStore - EventStore instance
 * @param {any} deps.pool - Relay pool instance
 * @param {any} deps.addressLoader - Address loader for replaceable events
 * @param {string[]} deps.relays - Relays for fetching referenced events
 * @param {Set<string>} [deps.loadedIds] - Already-resolved event IDs (for dedup across calls)
 * @param {Set<string>} [deps.loadedAddresses] - Already-resolved address coordinates (for dedup)
 * @returns {import('rxjs').Subscription[]} Subscriptions for cleanup
 */
export function resolveRepostReferences(
  repostEvents,
  { eventStore, pool, addressLoader, relays, loadedIds, loadedAddresses }
) {
  const seenIds = loadedIds || new Set();
  const seenAddrs = loadedAddresses || new Set();
  const newEventIds = [];
  /** @type {import('rxjs').Subscription[]} */
  const subs = [];

  for (const repost of repostEvents) {
    // 1. Extract embedded event from content
    const embedded = getEmbededSharedEvent(repost);
    if (embedded) {
      eventStore.add(embedded);
    }

    // 2. Collect e-tag references for batch fetch
    const eventPointer = getSharedEventPointer(repost);
    if (eventPointer && !seenIds.has(eventPointer.id)) {
      seenIds.add(eventPointer.id);
      newEventIds.push(eventPointer.id);
    }

    // 3. Resolve a-tag address pointers
    const addrPointer = getSharedAddressPointer(repost);
    if (addrPointer) {
      const coord = `${addrPointer.kind}:${addrPointer.pubkey}:${addrPointer.identifier}`;
      if (!seenAddrs.has(coord)) {
        seenAddrs.add(coord);
        const sub = addressLoader({
          kind: addrPointer.kind,
          pubkey: addrPointer.pubkey,
          identifier: addrPointer.identifier,
          relays
        }).subscribe();
        subs.push(sub);
      }
    }
  }

  // Batch fetch all new event IDs
  const fetchSub = fetchEventsByIds(newEventIds, relays, { pool, eventStore });
  if (fetchSub) subs.push(fetchSub);

  return subs;
}
