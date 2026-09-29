/**
 * Reactive hook: candidates for the composer's `@` people picker.
 *
 * Same sources and order as the people search (follows → locally known
 * profiles → NIP-50 relay, trust-ranked), capped at 8, minus the active
 * user, shaped for MentionAutocomplete rows. `null` from the query getter
 * means the picker is closed — nothing is searched, nothing is returned.
 *
 * MUST be called during component init (usePeopleSearch uses $effect).
 */
import { usePeopleSearch } from '$lib/stores/people-search.svelte.js';
import { useActiveUser } from '$lib/stores/accounts.svelte.js';
import { getUserDisplayName } from '$lib/helpers/message-utils.js';

/**
 * @typedef {{
 *   pubkey: string,
 *   name: string,
 *   profile: { name: string | null, display_name: string | null, picture: string | null }
 * }} MentionCandidate
 */

const LIMIT = 8;

/**
 * @param {() => string | null} getQuery - text after the `@`, or null when closed
 * @returns {() => MentionCandidate[]}
 */
export function useMentionCandidates(getQuery) {
  const getActiveUser = useActiveUser();
  const getSearch = usePeopleSearch(() => getQuery() ?? '', { limit: LIMIT, minTerm: 0 });

  const candidates = $derived.by(() => {
    if (getQuery() === null) return [];
    const me = getActiveUser()?.pubkey;
    /** @type {MentionCandidate[]} */
    const rows = [];
    for (const c of getSearch().results) {
      if (c.pubkey === me) continue;
      const profile = { name: c.name, display_name: c.display_name, picture: c.picture };
      rows.push({ pubkey: c.pubkey, name: getUserDisplayName(c.pubkey, profile), profile });
      if (rows.length === LIMIT) break;
    }
    return rows;
  });

  return () => candidates;
}
