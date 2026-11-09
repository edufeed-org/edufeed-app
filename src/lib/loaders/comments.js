/**
 * Comment loader for NIP-22 comments and NIP-10 replies
 * Provides a factory for creating timeline loaders specific to event comments
 */
import { EMPTY, catchError, defer, from, merge, of, switchMap } from 'rxjs';
import { getSeenRelays, normalizeURL } from 'applesauce-core/helpers';
import { fetchEvents } from '$lib/loaders/base.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { fetchRelayList } from '$lib/services/relay-service.svelte.js';

/** @param {string} url */
function normalize(url) {
  try {
    return normalizeURL(url);
  } catch {
    return url;
  }
}

/**
 * Create a comment loader for any event type (regular or addressable).
 * Auto-detects the event type and uses the correct filter:
 * - Addressable events (kind 30000-39999): #A filter with address
 * - Kind 1 events: dual-filter (kind 1111 #E + kind 1 #e) merged
 * - Other regular events: #E filter with event ID
 *
 * Relays: the root event's seen relays (where it was found) plus fallback
 * relays and any extras, and — in a parallel leg — the root author's NIP-65
 * read and write relays. Comments p-tag the root author, so outbox clients
 * deliver them to the author's read relays, and the author's own replies sit
 * on their write relays; an author on their own relay is invisible to the
 * first set (hodlbod's replies on canoe.coracle.social, 2026-11-09).
 *
 * @param {any} rootEvent - The root event to load comments for
 * @param {string[]} [extraRelays] - Additional relays to query
 * @returns {import('rxjs').Observable<any>} One-shot: cache + relays into the EventStore
 */
export const createCommentLoaderForEvent = (rootEvent, extraRelays) => {
  if (!rootEvent) {
    throw new Error('Root event is required to create comment loader');
  }

  const isAddressable = rootEvent.kind >= 30000 && rootEvent.kind < 40000;

  const seenRelays = getSeenRelays(rootEvent);
  const relays = [
    ...(runtimeConfig.fallbackRelays || []),
    ...(seenRelays ? Array.from(seenRelays) : []),
    ...(extraRelays || [])
  ];
  const uniqueRelays = [...new Set(relays)];

  /** @type {import('nostr-tools').Filter[]} */
  const filters = [];
  if (isAddressable) {
    const dTag = rootEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    filters.push({
      kinds: [1111],
      '#A': [`${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`],
      limit: 100
    });
  } else {
    // NIP-22 comments filter (works for all regular events)
    filters.push({ kinds: [1111], '#E': [rootEvent.id], limit: 100 });
    // Kind 1 notes also get NIP-10 replies (kind 1 with #e tag)
    if (rootEvent.kind === 1) filters.push({ kinds: [1], '#e': [rootEvent.id], limit: 100 });
  }

  /** @param {string[]} targets @param {boolean} cache */
  const fetchAll = (targets, cache) =>
    merge(...filters.map((filter) => fetchEvents(targets, filter, { cache })));

  const asked = new Set(uniqueRelays.map(normalize));
  const authorRelays$ = defer(() => from(fetchRelayList(rootEvent.pubkey))).pipe(
    catchError(() => of(null)),
    switchMap((list) => {
      const own = [
        ...new Set([...(list?.readRelays ?? []), ...(list?.writeRelays ?? [])].map(normalize))
      ].filter((relay) => !asked.has(relay));
      // The IDB cache was already asked by the first leg
      return own.length > 0 ? fetchAll(own, false) : EMPTY;
    }),
    catchError(() => EMPTY)
  );

  return merge(fetchAll(uniqueRelays, true), authorRelays$);
};

/**
 * Create a comment loader for a URL-rooted thread (NIP-22 page notes).
 * Page notes carry ["I", url] + ["K", "web"] root tags and are discoverable
 * via the #I tag filter. Used to surface URL-level conversations independent
 * of any specific event id.
 *
 * @param {string} url - The page URL to load comments for
 * @param {string[]} [extraRelays] - Additional relays to query
 * @returns {import('rxjs').Observable<any>} One-shot: cache + relays into the EventStore
 */
export const createCommentLoaderForUrl = (url, extraRelays) => {
  if (!url) {
    throw new Error('URL is required to create URL-rooted comment loader');
  }

  const relays = [...(runtimeConfig.fallbackRelays || []), ...(extraRelays || [])];
  const uniqueRelays = [...new Set(relays)];

  /** @type {import('nostr-tools').Filter} */
  const filter = { kinds: [1111], '#I': [url], limit: 100 };

  return fetchEvents(uniqueRelays, filter, { cache: true });
};
