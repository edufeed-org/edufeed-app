/**
 * Shared repost resolution utilities.
 *
 * Extracts the repost reference resolution pattern used by both community content
 * loaders and the follows feed. Uses applesauce helpers instead of manual tag parsing.
 */
import { EMPTY, catchError, concat, defer, merge, tap } from 'rxjs';
import {
  getEmbededSharedEvent,
  getSharedEventPointer,
  getSharedAddressPointer
} from 'applesauce-common/helpers';
import { unique } from '$lib/helpers/unique.js';

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
    .request(relays, [{ ids }], { timeout: 5000 })
    .pipe(
      tap((event) => eventStore.add(event)),
      // Timeout or (v7) every relay failing: a missing repost target is not
      // an error for the feed, so swallow instead of surfacing an
      // unhandled rxjs error.
      catchError(() => EMPTY)
    )
    .subscribe();
}

/**
 * Resolve repost target references: extract embedded events, fetch by ID/address.
 *
 * For each repost event:
 * 1. Try to extract the embedded event from content → add to eventStore immediately
 * 2. Collect e-tag pointers: one batch request for all ids on `relays`; the
 *    ids it did not return go through `loadReferenced` with the e-tag's relay
 *    hint and author, so a target only its author's relays carry (hint or
 *    NIP-65 outboxes) still resolves
 * 3. Resolve a-tag address pointers via `loadReferenced` (hint + `relays`,
 *    then the author's outboxes)
 *
 * @param {any[]} repostEvents - Kind 6/16 repost events
 * @param {Object} deps
 * @param {any} deps.eventStore - EventStore instance
 * @param {any} deps.pool - Relay pool instance
 * @param {(pointer: any, options?: { author?: string }) => import('rxjs').Observable<any>} deps.loadReferenced
 *   - `loadReferencedEvent` from `$lib/loaders/referenced-event.js` (injected)
 * @param {string[]} deps.relays - Relays for fetching referenced events
 * @param {Set<string>} [deps.loadedIds] - Already-resolved event IDs (for dedup across calls)
 * @param {Set<string>} [deps.loadedAddresses] - Already-resolved address coordinates (for dedup)
 * @returns {import('rxjs').Subscription[]} Subscriptions for cleanup
 */
export function resolveRepostReferences(
  repostEvents,
  { eventStore, pool, loadReferenced, relays, loadedIds, loadedAddresses }
) {
  const seenIds = loadedIds || new Set();
  const seenAddrs = loadedAddresses || new Set();
  /** @type {{ id: string, relays?: string[], author?: string }[]} */
  const newPointers = [];
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
      newPointers.push(eventPointer);
    }

    // 3. Resolve a-tag address pointers
    const addrPointer = getSharedAddressPointer(repost);
    if (addrPointer) {
      const coord = `${addrPointer.kind}:${addrPointer.pubkey}:${addrPointer.identifier}`;
      if (!seenAddrs.has(coord)) {
        seenAddrs.add(coord);
        const sub = loadReferenced({
          kind: addrPointer.kind,
          pubkey: addrPointer.pubkey,
          identifier: addrPointer.identifier,
          relays: unique([...(addrPointer.relays ?? []), ...relays])
        }).subscribe();
        subs.push(sub);
      }
    }
  }

  // Batch fetch all new event IDs, then the misses one by one with their hints
  if (newPointers.length > 0) {
    const batch$ = pool
      .request(relays, [{ ids: newPointers.map((p) => p.id) }], { timeout: 5000 })
      .pipe(
        tap((event) => eventStore.add(event)),
        catchError(() => EMPTY)
      );
    const misses$ = defer(() =>
      merge(
        ...newPointers
          .filter((p) => !eventStore.getEvent(p.id))
          .map((p) =>
            loadReferenced(
              { id: p.id, relays: unique([...(p.relays ?? []), ...relays]) },
              { author: p.author }
            )
          )
      )
    );
    subs.push(concat(batch$, misses$).subscribe());
  }

  return subs;
}
