/**
 * Reactions loader for NIP-25 reactions
 * Wraps the base loader to also query the event author's inbox relays
 */
import { merge, from, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { createReactionsLoader } from 'applesauce-loaders/loaders';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getReadRelays } from '$lib/services/relay-service.svelte.js';

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
