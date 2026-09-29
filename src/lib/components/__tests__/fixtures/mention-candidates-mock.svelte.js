/**
 * Reactive stand-in for useMentionCandidates() in component tests. Set
 * `mentions.candidates`, then `mentions.bump()` to simulate results arriving
 * after the picker opened. `mentions.lastQuery` records what the composer
 * asked for on the most recent read.
 */

export const mentions = {
  /** @type {Array<{pubkey: string, name: string, profile: any}>} */
  candidates: [],
  /** @type {string | null} */
  lastQuery: null,
  /** @type {() => void} */
  bump: () => {}
};

/** @param {() => string | null} getQuery */
export function useMentionCandidates(getQuery) {
  let version = $state(0);
  mentions.bump = () => {
    version++;
  };
  return () => {
    void version;
    const q = getQuery();
    mentions.lastQuery = q;
    if (q === null) return [];
    const needle = q.toLowerCase();
    return mentions.candidates.filter((c) => !needle || c.name.toLowerCase().includes(needle));
  };
}
