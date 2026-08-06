// Where the rail's arrangement is kept.
//
// ON THIS DEVICE, per account — deliberately, and this is the one decision in
// the feature worth arguing about. The obvious DRY move was the pattern profile
// tabs already use: a public kind:30078 (`d=edufeed:profile-tabs`), which would
// also sync across devices the way Armada's rail does. But this rail names
// unlinked Concord AREAS and privately-held NIP-29 groups, so publishing it in
// the clear would announce which private rooms the user holds and how they
// filed them. Armada answers that by ENCRYPTING its settings event; that is the
// right end state, it needs a NIP-44-capable signer, and it fits on top of
// rail-layout.js without touching a line of the model. Until then: local.
//
// Reads are made reactive in-tab by a version counter, the convention every
// other localStorage-backed flag here follows (nip05-hint-flags.svelte.js).

import { normalizeLayout } from './rail-layout.js';

const LAYOUT_PREFIX = 'rail-layout:';
const OPEN_PREFIX = 'rail-open-folders:';

let version = $state(0);

/**
 * The stored arrangement, exactly as it was written. Untrusted — every reader
 * goes through normalizeLayout, which is where junk is dropped.
 * @param {string | null | undefined} pubkey
 * @returns {unknown}
 */
export function readRailLayout(pubkey) {
  void version;
  if (!pubkey || typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_PREFIX + pubkey) ?? '[]');
  } catch {
    // A layout that will not parse is a layout the user cannot fix by hand.
    // Falling back to the default order loses their arrangement; keeping the
    // rail empty would lose their communities, which is far worse.
    return [];
  }
}

/**
 * @param {string | null | undefined} pubkey
 * @param {import('./rail-layout.js').RailNode[]} layout
 */
export function writeRailLayout(pubkey, layout) {
  if (!pubkey || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LAYOUT_PREFIX + pubkey, JSON.stringify(layout));
  } catch {
    // A full quota must not take the drag with it: the move already happened
    // in memory and stays until reload.
  }
  version++;
}

/**
 * Which folders are open. Per device, never part of the layout — Armada and
 * Discord both keep this local, because it is navigation state, not
 * arrangement.
 * Returned as an array rather than a Set: this project's lint forbids a plain
 * Set in a `.svelte.js` module (svelte/prefer-svelte-reactivity), and a
 * reactive Set would be the wrong shape anyway — the value is rebuilt on every
 * read, never mutated in place.
 *
 * @param {string | null | undefined} pubkey
 * @returns {string[]}
 */
export function readOpenFolders(pubkey) {
  void version;
  if (!pubkey || typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_PREFIX + pubkey) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * @param {string | null | undefined} pubkey
 * @param {string[]} ids
 */
export function writeOpenFolders(pubkey, ids) {
  if (!pubkey || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(OPEN_PREFIX + pubkey, JSON.stringify([...ids]));
  } catch {
    /* see writeRailLayout */
  }
  version++;
}

/**
 * A folder id that no existing folder uses. Random ids would be shorter, but
 * `Math.random` in a store makes every test that touches it order-dependent —
 * and the id only has to be unique within one user's rail.
 * @param {import('./rail-layout.js').RailNode[]} layout
 * @returns {string}
 */
export function nextFolderId(layout) {
  const used = (layout ?? []).filter((n) => n.type === 'folder').map((n) => n.id);
  let n = 1;
  while (used.includes(`f${n}`)) n++;
  return `f${n}`;
}

/**
 * The rail's arrangement, reconciled against what actually exists.
 *
 * The normalized value is NOT written back on read: a save on every render
 * would turn "the relay is still loading my communities" into "the user
 * deleted them". Only an explicit arrangement is stored.
 *
 * @param {() => string | null | undefined} getPubkey
 * @param {() => string[]} getLiveKeys default order
 * @returns {() => import('./rail-layout.js').RailNode[]}
 */
export function useRailLayout(getPubkey, getLiveKeys) {
  return () => normalizeLayout(readRailLayout(getPubkey()), getLiveKeys());
}
