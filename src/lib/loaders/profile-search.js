/**
 * NIP-50 Search Loader for profiles (kind 0)
 *
 * Used by the impersonation warning to find similarly named profiles.
 * Uses pool.request() directly to preserve the NIP-50 search field —
 * createTimelineLoader strips unknown filter fields. Relays without NIP-50
 * support simply return nothing; callers must degrade gracefully.
 */
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';

/**
 * Search kind-0 profiles by name across the profile lookup relays.
 *
 * @param {string} name - free-text search term (profile name)
 * @param {number} [limit=10]
 * @returns {import('rxjs').Observable<import('nostr-tools').Event>}
 */
export function profileNameSearchLoader(name, limit = 10) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return new Observable((subscriber) => {
      subscriber.complete();
    });
  }

  const relays = getProfileLookupRelays();
  const filter = { kinds: [0], search: trimmed, limit };

  return pool
    .request(relays, filter, /** @type {any} */ ({ timeout: 5000 }))
    .pipe(tap((event) => eventStore.add(event)));
}
