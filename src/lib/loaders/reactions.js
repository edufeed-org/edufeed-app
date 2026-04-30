/**
 * Reactions loader for NIP-25 reactions
 * Wraps the base loader to also query the event author's inbox relays
 */
import { merge, from, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { createReactionsLoader } from 'applesauce-loaders/loaders';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getReadRelays } from '$lib/services/relay-service.svelte.js';
import { createCachedTimelineLoader } from '$lib/loaders/base.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

const baseLoader = createReactionsLoader(pool, {
  useSeenRelays: true,
  eventStore,
  bufferTime: 1000
});

/**
 * Load reactions for an event, querying both seen relays and the author's inbox relays.
 *
 * @param {import('nostr-tools').Event} event
 * @param {string[]} [relays]
 * @returns {import('rxjs').Observable<any>}
 */
export function reactionsLoader(event, relays) {
  const base$ = baseLoader(event, relays);

  const inbox$ = from(getReadRelays(event.pubkey)).pipe(
    switchMap((inboxRelays) => {
      if (!inboxRelays || inboxRelays.length === 0) return EMPTY;
      return baseLoader(event, inboxRelays);
    }),
    catchError(() => EMPTY)
  );

  return merge(base$, inbox$);
}

/**
 * Create a reactions loader for a URL-rooted thread (NIP-25 external reactions, kind 17).
 * Per NIP-25, kind 17 reactions target external content via NIP-73 ["i", url] + ["k", "web"]
 * tags and are discoverable via the #i tag filter.
 *
 * Mirror of createCommentLoaderForUrl in $lib/loaders/comments.js.
 *
 * @param {string} url - The page URL to load reactions for
 * @param {string[]} [extraRelays] - Additional relays to query
 * @returns {Function} Timeline loader function that returns an Observable
 */
export function reactionsLoaderForUrl(url, extraRelays) {
  if (!url) {
    throw new Error('URL is required to create URL-rooted reactions loader');
  }

  const relays = [...(runtimeConfig.fallbackRelays || []), ...(extraRelays || [])];
  const uniqueRelays = [...new Set(relays)];

  /** @type {import('nostr-tools').Filter} */
  const filter = { kinds: [17], '#i': [url], limit: 100 };

  return createCachedTimelineLoader(uniqueRelays, filter);
}
