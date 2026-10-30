/**
 * Reactive stand-in for $lib/stores/member-directory.svelte.js. Set
 * `directory.members` then call `directory.bump()` to simulate the
 * directory (or its members' profiles) arriving after the first render.
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- test double, swapped wholesale per test */
let version = $state(0);

export const directory = {
  /** @type {Set<string>} */
  members: new Set(),
  domain: 'edufeed.org',
  ensured: 0,
  bump: () => {
    version++;
  }
};

export function getMemberPubkeys() {
  void version;
  return directory.members;
}

export function getMemberDirectoryVersion() {
  return version;
}

export function getMemberDomain() {
  return directory.domain;
}

export function ensureMemberDirectory() {
  directory.ensured++;
}
