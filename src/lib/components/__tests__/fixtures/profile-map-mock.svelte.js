/**
 * Reactive stand-in for useProfileMap() in component tests: set
 * `profiles.map`, then `profiles.bump()` to simulate a profile arriving after
 * the render. `profiles.requested` records the pubkeys asked for last.
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- test double, swapped wholesale per test */
export const profiles = {
  /** @type {Map<string, any>} */
  map: new Map(),
  /** @type {string[]} */
  requested: [],
  /** @type {() => void} */
  bump: () => {}
};

/** @param {() => Iterable<string>} getPubkeys */
export function useProfileMap(getPubkeys) {
  let version = $state(0);
  profiles.bump = () => {
    version++;
  };
  return () => {
    void version;
    profiles.requested = [...getPubkeys()];
    return profiles.map;
  };
}
