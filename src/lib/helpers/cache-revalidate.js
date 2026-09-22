/**
 * Stale-while-revalidate for the persistent event cache.
 *
 * applesauce's address loader runs its sources as a SEQUENCE and stops at the
 * first one that yields the address (`addressPointerLoadingSequence`). With a
 * `cacheRequest` wired in, a cache hit therefore ends the lookup: no relay is
 * ever asked, and a profile, community definition, article, resource or
 * calendar event that once landed in IndexedDB keeps rendering from that copy
 * until the row is evicted. That is what users see as "stale" or "deleted but
 * still there" content.
 *
 * This wrapper keeps the instant paint from the cache and, for every
 * replaceable/addressable event the cache served, hands the address to
 * `revalidate` once per session. The caller re-requests it with `cache: false`
 * (the pointer flag applesauce honours to skip the cache step), so the relays
 * get asked exactly once for each cached address; a newer version replaces the
 * stale one in the EventStore and is persisted by the normal write pipeline.
 *
 * Regular (non-replaceable) events are immutable, so a cache hit for them is
 * final — deletions are covered by the DeleteManager sync in event-cache.
 */

import {
  getReplaceableIdentifier,
  isAddressableKind,
  isReplaceableKind
} from 'applesauce-core/helpers';

/**
 * @typedef {{ kind: number, pubkey: string, identifier?: string }} RevalidatePointer
 */

/**
 * @param {(filters: import('nostr-tools').Filter[]) => Promise<import('nostr-tools').Event[]>} cacheRequest
 *   The raw cache reader (IDB).
 * @param {(pointers: RevalidatePointer[]) => void} revalidate
 *   Called with the not-yet-revalidated addresses of one cache response.
 * @returns {(filters: import('nostr-tools').Filter[]) => Promise<import('nostr-tools').Event[]>}
 */
export function createRevalidatingCacheRequest(cacheRequest, revalidate) {
  /** Addresses already handed to `revalidate` this session. */
  const revalidated = new Set();

  return async (filters) => {
    const events = await cacheRequest(filters);
    try {
      /** @type {RevalidatePointer[]} */
      const pointers = [];
      for (const event of events) {
        const addressable = isAddressableKind(event.kind);
        if (!addressable && !isReplaceableKind(event.kind)) continue;
        const identifier = addressable ? getReplaceableIdentifier(event) : undefined;
        const address = `${event.kind}:${event.pubkey}:${identifier ?? ''}`;
        if (revalidated.has(address)) continue;
        revalidated.add(address);
        pointers.push(
          addressable
            ? { kind: event.kind, pubkey: event.pubkey, identifier }
            : { kind: event.kind, pubkey: event.pubkey }
        );
      }
      if (pointers.length > 0) revalidate(pointers);
    } catch (err) {
      console.warn('[event-cache] revalidation failed', err);
    }
    return events;
  };
}
