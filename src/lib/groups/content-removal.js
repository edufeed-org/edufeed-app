// src/lib/groups/content-removal.js
//
// Removing content from a community — pure half.
//
// Content reaches a community's sections by carrying the community's pubkey
// in an `h` tag (directly, or via a NIP-18 repost / legacy 30222). Nothing in
// Nostr lets a moderator delete someone else's event: NIP-09 is author-only
// and NIP-29's kind 9005 only covers events the group relay itself holds.
// What the people running a community CAN do is publish their own signed
// opinion that an item does not belong, and let readers honour it when the
// opinion comes from someone with authority. That is exactly what NIP-32
// labels (kind 1985) exist for ("distributed moderation"), so a removal is:
//
//   kind 1985
//   ["L", "communikey.moderation"]
//   ["l", "remove", "communikey.moderation"]
//   ["h", <communityPubkey>]            scope: the community the item leaves
//   ["k", <kind>]
//   ["e", <id>, <relay-hint>]           always
//   ["a", <kind:pubkey:d>, <hint>]      for addressable content, so an edit
//                                       (new id, same d) stays removed
//
// Validity is judged by the READER at read time, the same way the kind-30223
// section override is: the label counts only if its author is the community
// key itself, or — on a moderated community — currently holds a moderation
// role on the root group's 39001. Demoting a moderator therefore revokes
// their removals with nothing to delete. Undo is the author's own NIP-09
// deletion of the label, which every relay and applesauce's DeleteManager
// already honour (author deletes own event).
//
// What a removal does NOT do: touch the original event. It stays on the
// relays, in global feeds and on the author's profile — the community simply
// stops showing it. Spec: docs/nips/communikey-groups.md, "Removing content".
import { deriveCommunityType } from './community-membership.js';
import { hasModerationRole, moderationPubkeys } from './roles.js';

export const CONTENT_REMOVAL_KIND = 1985;
export const CONTENT_REMOVAL_NAMESPACE = 'communikey.moderation';
export const CONTENT_REMOVAL_LABEL = 'remove';

/**
 * @typedef {{ids: Set<string>, addresses: Set<string>}} RemovedTargets
 * @typedef {{communityPubkey: string, kind: number | null, ids: string[], addresses: string[]}} ContentRemoval
 */

const HEX64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^(\d+):([0-9a-f]{64}):(.*)$/s;

/** @type {RemovedTargets} */
export const NO_REMOVALS = Object.freeze({ ids: new Set(), addresses: new Set() });

/**
 * @param {any} event
 * @param {string} name
 * @returns {string | undefined}
 */
function tagValue(event, name) {
  return event?.tags?.find((/** @type {string[]} */ t) => t[0] === name)?.[1];
}

/**
 * `kind:pubkey:d` for addressable kinds (30000–39999) carrying a `d` tag,
 * else null. Pure: no applesauce caching (CLAUDE.md, "Applesauce Functions
 * That Mutate").
 * @param {any} event
 * @returns {string | null}
 */
export function eventAddress(event) {
  if (!event || typeof event.kind !== 'number' || !event.pubkey) return null;
  if (event.kind < 30000 || event.kind >= 40000) return null;
  const d = tagValue(event, 'd');
  if (d === undefined) return null;
  return `${event.kind}:${event.pubkey}:${d}`;
}

/**
 * Unsigned kind-1985 template. The caller signs it with whichever key has
 * authority (publishContentRemoval.js picks it).
 * @param {string} communityPubkey
 * @param {any} event the content event leaving the community
 * @param {string} [relayHint]
 * @returns {{kind: number, content: string, tags: string[][]}}
 */
export function buildContentRemovalTemplate(communityPubkey, event, relayHint = '') {
  const tags = [
    ['L', CONTENT_REMOVAL_NAMESPACE],
    ['l', CONTENT_REMOVAL_LABEL, CONTENT_REMOVAL_NAMESPACE],
    ['h', communityPubkey],
    ['k', String(event.kind)],
    ['e', event.id, relayHint]
  ];
  const address = eventAddress(event);
  if (address) tags.push(['a', address, relayHint]);
  return { kind: CONTENT_REMOVAL_KIND, content: '', tags };
}

/**
 * Read a label back. Null when it is not a removal in our namespace, is not
 * scoped to a community, or names no well-formed target.
 * @param {any} label
 * @returns {ContentRemoval | null}
 */
export function parseContentRemoval(label) {
  if (!label || label.kind !== CONTENT_REMOVAL_KIND || !Array.isArray(label.tags)) return null;
  const inNamespace = label.tags.some(
    (/** @type {string[]} */ t) => t[0] === 'L' && t[1] === CONTENT_REMOVAL_NAMESPACE
  );
  const isRemove = label.tags.some(
    (/** @type {string[]} */ t) =>
      t[0] === 'l' && t[1] === CONTENT_REMOVAL_LABEL && t[2] === CONTENT_REMOVAL_NAMESPACE
  );
  const communityPubkey = tagValue(label, 'h');
  if (!inNamespace || !isRemove || !communityPubkey || !HEX64.test(communityPubkey)) return null;

  /** @type {string[]} */
  const ids = [];
  /** @type {string[]} */
  const addresses = [];
  for (const t of label.tags) {
    if (t[0] === 'e' && HEX64.test(t[1] ?? '') && !ids.includes(t[1])) ids.push(t[1]);
    if (t[0] === 'a' && ADDRESS.test(t[1] ?? '') && !addresses.includes(t[1])) addresses.push(t[1]);
  }
  if (ids.length === 0 && addresses.length === 0) return null;
  const k = Number.parseInt(tagValue(label, 'k') ?? '', 10);
  return { communityPubkey, kind: Number.isFinite(k) ? k : null, ids, addresses };
}

/**
 * Who may remove content from this community: the community key always; on a
 * moderated community also every CURRENT moderation-role holder (never
 * publisher-only or custom-role entries — roles.js). Open and closed
 * communities have no public roster to judge anyone else against.
 * @param {any} communityEvent kind 10222
 * @param {Array<{pubkey: string, roles?: string[]}> | undefined | null} admins root-group 39001
 * @returns {string[]}
 */
export function removalAuthorities(communityEvent, admins) {
  if (!communityEvent?.pubkey) return [];
  const authorities = [communityEvent.pubkey];
  if (deriveCommunityType(communityEvent) === 'moderated') {
    for (const pubkey of moderationPubkeys(admins)) {
      if (!authorities.includes(pubkey)) authorities.push(pubkey);
    }
  }
  return authorities;
}

/**
 * @param {any} label
 * @param {string | undefined | null} communityPubkey
 * @param {string[]} authorities from removalAuthorities()
 * @returns {boolean}
 */
export function isValidContentRemoval(label, communityPubkey, authorities) {
  const parsed = parseContentRemoval(label);
  if (!parsed || !communityPubkey || parsed.communityPubkey !== communityPubkey) return false;
  return authorities.includes(label.pubkey);
}

/**
 * The labels that count, newest first (the settings list shows them in
 * that order).
 * @param {any[]} labels candidate kind-1985 events, unfiltered
 * @param {string | undefined | null} communityPubkey
 * @param {string[]} authorities
 * @returns {any[]}
 */
export function validContentRemovals(labels, communityPubkey, authorities) {
  return (labels ?? [])
    .filter((label) => isValidContentRemoval(label, communityPubkey, authorities))
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
}

/**
 * Union of every target the given (already validated) labels name.
 * @param {any[]} labels
 * @returns {RemovedTargets}
 */
export function removedTargets(labels) {
  const ids = new Set();
  const addresses = new Set();
  for (const label of labels ?? []) {
    const parsed = parseContentRemoval(label);
    if (!parsed) continue;
    for (const id of parsed.ids) ids.add(id);
    for (const address of parsed.addresses) addresses.add(address);
  }
  return { ids, addresses };
}

/**
 * The id and address of whatever a community view hands us: a raw event, a
 * calendar item (`originalEvent` + `dTag`), an AMB item (`tags` kept, d-tag
 * as `identifier`), or a repost-resolved item (same shapes plus `_sharedBy`).
 * @param {any} item
 * @returns {{id: string | undefined, address: string | null}}
 */
export function itemTarget(item) {
  if (!item) return { id: undefined, address: null };
  const source = item.originalEvent ?? item.event ?? item;
  const id = source.id ?? item.id;
  let address = eventAddress(source);
  if (!address && typeof item.kind === 'number' && item.pubkey) {
    const d = item.dTag ?? item.identifier;
    if (typeof d === 'string' && item.kind >= 30000 && item.kind < 40000) {
      address = `${item.kind}:${item.pubkey}:${d}`;
    }
  }
  return { id, address };
}

/**
 * @param {any} item
 * @param {RemovedTargets | undefined | null} removed
 * @returns {boolean}
 */
export function isRemovedItem(item, removed) {
  if (!removed || (removed.ids.size === 0 && removed.addresses.size === 0)) return false;
  const { id, address } = itemTarget(item);
  if (id && removed.ids.has(id)) return true;
  return !!address && removed.addresses.has(address);
}

/**
 * Same array reference when nothing is removed, so `$derived` consumers do
 * not re-render needlessly (mirrors filterByAllowedAuthors).
 * @template T
 * @param {T[]} items
 * @param {RemovedTargets | undefined | null} removed
 * @returns {T[]}
 */
export function filterRemoved(items, removed) {
  if (!removed || (removed.ids.size === 0 && removed.addresses.size === 0)) return items;
  return items.filter((item) => !isRemovedItem(item, removed));
}

/**
 * The UI gate for the "remove from community" action and the removed-content
 * pane: holds the community key, or moderates a moderated community's root
 * group. Deliberately the same rule as removalAuthorities(), from the
 * viewer's side.
 * @param {{communityEvent: any, admins?: Array<{pubkey: string, roles?: string[]}> | null, pubkey?: string | null, isOwner: boolean}} params
 * @returns {boolean}
 */
export function canModerateCommunity({ communityEvent, admins, pubkey, isOwner }) {
  if (isOwner) return true;
  if (!pubkey || !communityEvent) return false;
  if (deriveCommunityType(communityEvent) !== 'moderated') return false;
  return (admins ?? []).some((a) => a.pubkey === pubkey && hasModerationRole(a.roles));
}
