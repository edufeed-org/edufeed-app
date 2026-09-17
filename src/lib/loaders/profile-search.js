/**
 * Profile search (kind 0) — two legs that ContactSearchInput's
 * `searchProfiles` mode and the impersonation warning build on:
 *
 *   - searchKnownProfiles: synchronous, over the kind-0 events already in
 *     the EventStore (community members, chat authors, feed authors — anyone
 *     the app has seen this session or has in IDB).
 *   - profileNameSearchLoader: NIP-50 search on the configured search relays
 *     (PROFILE_SEARCH_RELAYS). Uses pool.request() directly to preserve the
 *     NIP-50 search field — createTimelineLoader strips unknown filter
 *     fields. Relays that reject `search` simply return nothing; callers
 *     must degrade gracefully.
 */
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getProfileContent } from 'applesauce-core/helpers';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getProfileSearchRelays } from '$lib/helpers/relay-helper.js';

/**
 * @typedef {import('$lib/stores/contacts.svelte.js').EnrichedContact} EnrichedContact
 */

/**
 * Map a kind-0 event to the EnrichedContact shape ContactSearchInput renders
 * for follows, so profiles from any source share one row type.
 * @param {any} event
 * @returns {EnrichedContact | null}
 */
export function profileToContact(event) {
  let profile;
  try {
    profile = getProfileContent(event);
  } catch {
    return null;
  }
  if (!profile || typeof profile !== 'object') return null;
  return {
    pubkey: event.pubkey,
    name: profile.name || null,
    display_name: profile.display_name || null,
    picture: profile.picture || null,
    nip05: profile.nip05 || null,
    about: profile.about || null
  };
}

/**
 * Case-insensitive substring match on name, display_name and nip05. Applied
 * to NIP-50 results too: search relays rank fuzzily and happily return
 * "Framasoft" for "Colibri" — a row the user cannot relate to their input.
 * @param {EnrichedContact | null} contact
 * @param {string} term
 */
export function profileMatches(contact, term) {
  if (!contact) return false;
  const t = (term || '').trim().toLowerCase();
  if (!t) return false;
  return [contact.name, contact.display_name, contact.nip05].some((v) =>
    (v || '').toLowerCase().includes(t)
  );
}

/**
 * Synchronous search over the kind-0 events already in the EventStore.
 * @param {string} term
 * @param {number} [limit=10]
 * @param {{exclude?: string[]}} [options]
 * @returns {EnrichedContact[]}
 */
export function searchKnownProfiles(term, limit = 10, { exclude = [] } = {}) {
  const trimmed = (term || '').trim();
  if (trimmed.length < 2) return [];
  const excluded = new Set(exclude);
  /** @type {EnrichedContact[]} */
  const results = [];
  for (const event of eventStore.getByFilters({ kinds: [0] })) {
    if (excluded.has(event.pubkey)) continue;
    const contact = profileToContact(event);
    if (!profileMatches(contact, trimmed)) continue;
    results.push(/** @type {EnrichedContact} */ (contact));
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * Search kind-0 profiles by name on the NIP-50 search relays.
 *
 * @param {string} name - free-text search term (profile name)
 * @param {number} [limit=10]
 * @param {string[]} [relays] - defaults to the configured PROFILE_SEARCH_RELAYS
 * @returns {import('rxjs').Observable<import('nostr-tools').Event>}
 */
export function profileNameSearchLoader(name, limit = 10, relays = getProfileSearchRelays()) {
  const trimmed = (name || '').trim();
  if (!trimmed || relays.length === 0) {
    return new Observable((subscriber) => {
      subscriber.complete();
    });
  }

  const filter = { kinds: [0], search: trimmed, limit };

  return pool
    .request(relays, filter, /** @type {any} */ ({ timeout: 5000 }))
    .pipe(tap((event) => eventStore.add(event)));
}
