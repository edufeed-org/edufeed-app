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
import { EMPTY, Observable, from, merge, of } from 'rxjs';
import { mergeMap, take, tap } from 'rxjs/operators';
import { getProfileContent } from 'applesauce-core/helpers';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import {
  getProfileLookupRelays,
  getProfileSearchRelays,
  getProfileSearchObserver
} from '$lib/helpers/relay-helper.js';
import { getSearchExtensions } from '$lib/helpers/relay-search-extensions.js';
import { getProfileNip05s, isNip05Address, resolveNip05 } from '$lib/helpers/nip05-verify.js';
import { profileLoader } from '$lib/loaders/profile.js';

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
    nip05s: getProfileNip05s(event),
    about: profile.about || null
  };
}

/**
 * Case-insensitive substring match on name, display_name and every nip05
 * address (content field and repeated tags). Applied to NIP-50 results too:
 * search relays rank fuzzily and happily return "Framasoft" for "Colibri" —
 * a row the user cannot relate to their input.
 * @param {EnrichedContact | null} contact
 * @param {string} term
 */
export function profileMatches(contact, term) {
  if (!contact) return false;
  const t = (term || '').trim().toLowerCase();
  if (!t) return false;
  return [contact.name, contact.display_name, contact.nip05, ...(contact.nip05s ?? [])].some((v) =>
    (v || '').toLowerCase().includes(t)
  );
}

/**
 * The address leg: `name@domain` is not a search term but a pointer. Ask the
 * domain for the pubkey (NIP-05 `/.well-known/nostr.json`) and emit that
 * pubkey's kind 0 — from the EventStore when we have it, otherwise via the
 * profile loader on the lookup relays. Empty when the domain does not know
 * the name. This is what makes an address on a flyer work in edufeed's
 * search the way it does in Amethyst, Damus or Primal.
 * @param {string} address
 * @returns {import('rxjs').Observable<import('nostr-tools').Event>}
 */
function nip05ProfileLeg(address) {
  return from(resolveNip05(address)).pipe(
    mergeMap((pubkey) => {
      if (!pubkey) return EMPTY;
      const cached = eventStore.getReplaceable(0, pubkey);
      if (cached) return of(cached);
      return profileLoader({ kind: 0, pubkey, relays: getProfileLookupRelays() }).pipe(take(1));
    })
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
 * @param {string[]} relays
 * @param {string} search
 * @param {number} limit
 */
function searchLeg(relays, search, limit) {
  return pool
    .request(relays, { kinds: [0], search, limit }, /** @type {any} */ ({ timeout: 5000 }))
    .pipe(tap((event) => eventStore.add(event)));
}

/**
 * Search kind-0 profiles by name on the NIP-50 search relays — or, when the
 * term is a full NIP-05 address, resolve it directly (see nip05ProfileLeg).
 *
 * Each relay gets at most one lens token, chosen from the NIP-50
 * extensions its NIP-11 advertises (see relay-search-extensions.js):
 *
 *   - `observer:<hex>` when PROFILE_SEARCH_OBSERVER is set and the relay
 *     advertises `observer` (Brainstorm) — hits ranked from that pubkey's
 *     web of trust;
 *   - otherwise `include:spam` when the relay advertises `include` —
 *     NosFabrica's vespa-relay refuses an anonymous REQ that names neither
 *     (CLOSED auth-required), and a lens-less search there has no spam
 *     floor to lift, so the token only gets the query through;
 *   - otherwise the plain term: a relay that advertises neither would
 *     treat the token as one more search word and find nothing.
 *
 * Relays that end up with the same search string share one request.
 *
 * @param {string} name - free-text search term (profile name)
 * @param {number} [limit=10]
 * @param {string[]} [relays] - defaults to the configured PROFILE_SEARCH_RELAYS
 * @returns {import('rxjs').Observable<import('nostr-tools').Event>}
 */
export function profileNameSearchLoader(name, limit = 10, relays = getProfileSearchRelays()) {
  const trimmed = (name || '').trim();
  if (isNip05Address(trimmed)) return nip05ProfileLeg(trimmed);
  if (!trimmed || relays.length === 0) {
    return new Observable((subscriber) => {
      subscriber.complete();
    });
  }

  const observer = getProfileSearchObserver();

  /** @param {string[]} extensions */
  const searchFor = (extensions) => {
    if (observer && extensions.includes('observer')) return `${trimmed} observer:${observer}`;
    if (extensions.includes('include')) return `${trimmed} include:spam`;
    return trimmed;
  };

  const groups = Promise.all(
    relays.map(async (url) => ({ url, search: searchFor(await getSearchExtensions(url)) }))
  ).then((probed) => {
    /** @type {Map<string, string[]>} search string → relays, first-seen order */
    const bySearch = new Map();
    for (const { url, search } of probed) {
      bySearch.set(search, [...(bySearch.get(search) ?? []), url]);
    }
    return [...bySearch];
  });

  return from(groups).pipe(
    mergeMap((entries) => merge(...entries.map(([search, urls]) => searchLeg(urls, search, limit))))
  );
}
