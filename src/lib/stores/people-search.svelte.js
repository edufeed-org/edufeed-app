/**
 * Reactive hook: page-level profile search for the discover "Personen" tab.
 *
 * Same sources and the same order as ContactSearchInput's `searchProfiles`
 * mode — the user's follows, the deployment's members (member-directory
 * store), other profiles already in the EventStore, then a debounced NIP-50
 * search on the configured search relays — each pubkey once, follows first,
 * everyone else by NIP-85 trust rank (unscored last, never dropped). The
 * ranked list is then split: members of NIP05_HANDLE_DOMAIN first, as their
 * own group (`memberResults`), everyone else after (`otherResults`).
 * `results` is both, in that order.
 *
 * A pasted npub / nprofile / hex key (or `nostr:` URI) is not a name: it
 * yields exactly that person and no relay search.
 *
 * Exposed as a result list instead of a dropdown so a page can render
 * cards, and the query can come from the URL.
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
import {
  ensureMemberDirectory,
  getMemberPubkeys,
  getMemberDirectoryVersion
} from '$lib/stores/member-directory.svelte.js';
import { membersFirst } from '$lib/helpers/member-directory.js';
import { normalizePubkey } from '$lib/helpers/pubkey.js';

const MIN_TERM = 2;
/** Known-profile and NIP-50 legs need this many chars regardless of minTerm. */
const MIN_SEARCH_TERM = 2;
/** @type {EnrichedContact} */
const EMPTY_CONTACT = {
  pubkey: '',
  name: null,
  display_name: null,
  picture: null,
  nip05: null,
  about: null
};

/**
 * @typedef {import('$lib/stores/contacts.svelte.js').EnrichedContact} EnrichedContact
 * @typedef {{
 *   term: string,
 *   tooShort: boolean,
 *   busy: boolean,
 *   results: EnrichedContact[],
 *   memberResults: EnrichedContact[],
 *   otherResults: EnrichedContact[],
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
  /** The person behind a pasted key — replaces the name search entirely. */
  let pasted = $state.raw(/** @type {EnrichedContact | null} */ (null));

  untrack(() => ensureMemberDirectory());

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

  const grouped = $derived.by(() => {
    if (pasted) return membersFirst([pasted], getMemberPubkeys());
    const scores = getScores();
    /** @param {string} pubkey */
    const rankOf = (pubkey) => scores.get(pubkey)?.rank ?? -1;
    // Stable sort keeps arrival order among ties and in the unscored tail.
    const ranked = [...follows, ...others.toSorted((a, b) => rankOf(b.pubkey) - rankOf(a.pubkey))];
    return membersFirst(ranked, getMemberPubkeys());
  });

  $effect(() => {
    const q = (getQuery() || '').trim();
    // Re-run once the member directory (or its members' profiles) arrives:
    // members found only in the store would otherwise wait for a new query.
    getMemberDirectoryVersion();
    untrack(() => {
      cancelRemote();
      term = q;
      const key = normalizePubkey(q);
      pasted = key ? { ...EMPTY_CONTACT, pubkey: key } : null;
      if (key || q.length < minTerm) {
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
        const members = [...getMemberPubkeys()];
        // Members first, on their own: a common name must not push them out
        // of the store-wide leg's `limit`.
        const memberHits = members.length
          ? searchKnownProfiles(q, limit, { exclude: [...seen], authors: members })
          : [];
        for (const c of [...memberHits, ...searchKnownProfiles(q, limit, { exclude: [...seen] })]) {
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
    tooShort: !pasted && term.length < minTerm,
    busy,
    results: [...grouped.members, ...grouped.others],
    memberResults: grouped.members,
    otherResults: grouped.others,
    scores: getScores()
  });
}
