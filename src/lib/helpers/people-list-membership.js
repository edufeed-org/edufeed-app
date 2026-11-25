/**
 * Which of my kind 30000 people lists contain a person — for the
 * "Zu Liste hinzufügen" picker on profiles (issue af4b3ae8).
 *
 * Pure: reads public `p` tags and, when already decrypted, the private
 * (NIP-51 hidden) part applesauce caches under Symbol.for('hidden-tags').
 */

const HIDDEN_TAGS = Symbol.for('hidden-tags');

/** @typedef {'public' | 'hidden' | 'none' | 'locked'} ListMembership */

/**
 * `locked` = the list has a private part that is not decrypted, so the person
 * may be in it privately: the picker must not add them publicly then (that
 * would publish a relation the owner kept private).
 *
 * @param {import('nostr-tools').NostrEvent} list
 * @param {string} pubkey
 * @returns {ListMembership}
 */
export function listMembership(list, pubkey) {
  const named = (/** @type {string[][]} */ tags) =>
    tags.some((t) => t[0] === 'p' && t[1] === pubkey);
  if (named(list.tags)) return 'public';
  if (!list.content) return 'none';
  const hidden = /** @type {any} */ (list)[HIDDEN_TAGS];
  if (!Array.isArray(hidden)) return 'locked';
  return named(hidden) ? 'hidden' : 'none';
}

/** @param {import('nostr-tools').NostrEvent} e */
const tag = (e, /** @type {string} */ name) => e.tags.find((t) => t[0] === name)?.[1] ?? '';

/** @param {import('nostr-tools').NostrEvent} e */
export const listTitle = (e) => tag(e, 'title') || tag(e, 'name') || tag(e, 'd');

/**
 * My people lists a person can be put on: kind 30000 except the Communikey
 * membership set (d = "communities", its p tags are communities, not people).
 *
 * @param {import('nostr-tools').NostrEvent[]} lists
 */
export function pickablePeopleLists(lists) {
  return lists
    .filter((e) => e.kind === 30000 && tag(e, 'd') !== 'communities')
    .toSorted((a, b) => listTitle(a).localeCompare(listTitle(b)));
}
