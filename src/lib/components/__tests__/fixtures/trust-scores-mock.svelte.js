/**
 * Reactive stand-in for useTrustScores() in component tests. Set
 * `trust.scores` then call `trust.bump()` to simulate a score arriving after
 * the rows rendered; runes need a .svelte.js module, hence the fixture.
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- test double, swapped wholesale per test */
export const trust = {
  /** @type {Map<string, any>} */
  scores: new Map(),
  /** @type {() => void} */
  bump: () => {}
};

export function useTrustScores() {
  let version = $state(0);
  trust.bump = () => {
    version++;
  };
  return () => {
    void version;
    return trust.scores;
  };
}
