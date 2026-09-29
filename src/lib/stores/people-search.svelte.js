/**
 * Reactive hook: page-level profile search for the discover "Personen" tab.
 *
 * Same three sources and the same order as ContactSearchInput's
 * `searchProfiles` mode — the user's follows, profiles already in the
 * EventStore, then a debounced NIP-50 search on the configured search
 * relays — each pubkey once, follows first, everyone else by NIP-85 trust
 * rank (unscored last, never dropped). Exposed as a result list instead of
 * a dropdown so a page can render cards, and the query can come from the
 * URL.
 *
 * MUST be called during component init (it uses $effect).
 */
import { untrack } from 'svelte';
import { contactsStore } from '$lib/stores/contacts.svelte.js';
import {
  searchKnownProfiles,
  profileNameSearchLoader,
  profileToContact,
  profileMatches
} from '$lib/loaders/profile-search.js';
import { useTrustScores } from '$lib/stores/trust-scores.svelte.js';

const MIN_TERM = 2;
/** Known-profile and NIP-50 legs need this many chars regardless of minTerm. */
const MIN_SEARCH_TERM = 2;

/**
 * @typedef {import('$lib/stores/contacts.svelte.js').EnrichedContact} EnrichedContact
 * @typedef {{
 *   term: string,
 *   tooShort: boolean,
 *   busy: boolean,
 *   results: EnrichedContact[],
 *   scores: Map<string, import('$lib/loaders/trust-assertions.js').TrustScore>
 * }} PeopleSearchState
 */

/**
 * `options.minTerm` is the shortest term that yields results (default 2);
 * 0 makes an empty term list the user's follows (the mention picker's bare
 * at-sign). The known-profile and relay legs always need two characters.
 *
 * @param {() => string} getQuery - reactive getter for the raw query
 * @param {{limit?: number, debounceMs?: number, minTerm?: number}} [options]
 * @returns {() => PeopleSearchState}
 */
export function usePeopleSearch(
  getQuery,
  { limit = 30, debounceMs = 300, minTerm = MIN_TERM } = {}
) {
  let term = $state('');
  let busy = $state(false);
  /** Follows matching the term — always first. */
  let follows = $state.raw(/** @type {EnrichedContact[]} */ ([]));
  /** Known + relay hits, in arrival order; ranked in the derived below. */
  let others = $state.raw(/** @type {EnrichedContact[]} */ ([]));

  // Remote-leg bookkeeping — plain lets, never $state (internal refs).
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {import('rxjs').Subscription | undefined} */
  let sub;

  function cancelRemote() {
    clearTimeout(timer);
    timer = undefined;
    sub?.unsubscribe();
    sub = undefined;
    busy = false;
  }

  const getScores = useTrustScores(() => [...follows, ...others].map((c) => c.pubkey));

  const results = $derived.by(() => {
    const scores = getScores();
    /** @param {string} pubkey */
    const rankOf = (pubkey) => scores.get(pubkey)?.rank ?? -1;
    // Stable sort keeps arrival order among ties and in the unscored tail.
    return [...follows, ...others.toSorted((a, b) => rankOf(b.pubkey) - rankOf(a.pubkey))];
  });

  $effect(() => {
    const q = (getQuery() || '').trim();
    untrack(() => {
      cancelRemote();
      term = q;
      if (q.length < minTerm) {
        follows = [];
        others = [];
        return;
      }
      const followHits = contactsStore.searchContacts(q, limit);
      // Dedupe scratch for this query only — never rendered, so a reactive
      // SvelteSet would only add proxy overhead.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const seen = new Set(followHits.map((c) => c.pubkey));
      const known = [];
      if (q.length >= MIN_SEARCH_TERM) {
        for (const c of searchKnownProfiles(q, limit, { exclude: [...seen] })) {
          if (seen.has(c.pubkey)) continue;
          seen.add(c.pubkey);
          known.push(c);
        }
      }
      follows = followHits;
      others = known;

      if (q.length < MIN_SEARCH_TERM) return;
      timer = setTimeout(() => {
        busy = true;
        sub = profileNameSearchLoader(q, limit).subscribe({
          next: (event) => {
            const contact = profileToContact(event);
            if (!contact || !profileMatches(contact, q) || seen.has(contact.pubkey)) return;
            seen.add(contact.pubkey);
            others = [...others, contact];
          },
          error: () => {
            busy = false;
          },
          complete: () => {
            busy = false;
          }
        });
      }, debounceMs);
    });
  });

  $effect(() => cancelRemote);

  return () => ({
    term,
    tooShort: term.length < minTerm,
    busy,
    results,
    scores: getScores()
  });
}
