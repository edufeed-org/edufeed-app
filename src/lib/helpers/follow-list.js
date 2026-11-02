/**
 * Pure helpers for the follower / following list (FollowListModal): an
 * alphabetical, searchable list of people with a phone-contacts style A-Z
 * index. Names come from kind 0 profiles; people whose profile has no name
 * (or has not arrived yet) sort last, by npub.
 */

/** The index rail: A-Z, then "#" for everything that does not start with a letter. */
export const RAIL_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

const OTHER = '#';
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

/**
 * Lowercase and strip diacritics (Ä→a, é→e) for matching and grouping.
 * @param {unknown} text
 * @returns {string}
 */
export function foldText(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The name a person is listed under: display name, else name (trimmed).
 * @param {any} profile
 * @returns {string}
 */
export function profileName(profile) {
  for (const value of [profile?.display_name, profile?.displayName, profile?.name]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Index letter of a name: its base letter A-Z (umlauts fold to their vowel),
 * "#" for anything else (digits, emoji, other scripts, no name).
 * @param {string} name
 * @returns {string}
 */
export function initialOf(name) {
  const first = foldText(name.trim()).charAt(0);
  return first >= 'a' && first <= 'z' ? first.toUpperCase() : OTHER;
}

/**
 * @typedef {Object} FollowListEntry
 * @property {string} pubkey
 * @property {string} npub
 * @property {string} name     - listed name ('' when the profile has none)
 * @property {string} initial  - index letter (A-Z or '#')
 * @property {string} search   - folded haystack: display name, name, NIP-05, npub
 */

/**
 * The list in display order: names starting with a letter A-Z
 * alphabetically (German collation, case-insensitive), then other names,
 * then nameless people by npub — so the "#" group is one block at the end,
 * like the rail.
 * @param {string[]} pubkeys
 * @param {Map<string, any>} profiles
 * @param {(hex: string) => string | null | undefined} npubOf
 * @returns {FollowListEntry[]}
 */
export function buildFollowListEntries(pubkeys, profiles, npubOf) {
  /** @type {FollowListEntry[]} */
  const entries = [];
  const seen = new Set();
  for (const pubkey of pubkeys) {
    if (seen.has(pubkey)) continue;
    seen.add(pubkey);
    const profile = profiles.get(pubkey);
    const npub = npubOf(pubkey) || pubkey;
    const name = profileName(profile);
    const parts = [
      profile?.display_name,
      profile?.displayName,
      profile?.name,
      profile?.nip05,
      npub
    ];
    entries.push({
      pubkey,
      npub,
      name,
      initial: initialOf(name),
      search: parts
        .filter((p) => typeof p === 'string')
        .map(foldText)
        .join(' ')
    });
  }
  /** @param {FollowListEntry} e */
  const rank = (e) => (!e.name ? 2 : e.initial === OTHER ? 1 : 0);
  return entries.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.name && b.name ? collator.compare(a.name, b.name) : 0) ||
      (a.npub < b.npub ? -1 : a.npub > b.npub ? 1 : 0)
  );
}

/**
 * The search box's words, folded; empty for a blank query.
 * @param {string} query
 * @returns {string[]}
 */
export function queryWords(query) {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/**
 * Every word must occur somewhere in the entry's names, NIP-05 or npub.
 * @param {{ search: string }} entry
 * @param {string[]} words
 * @returns {boolean}
 */
export function matchesQuery(entry, words) {
  return words.every((w) => entry.search.includes(w));
}

/**
 * Index letter → position of the first entry under it.
 * @param {{ initial: string }[]} entries
 * @returns {Map<string, number>}
 */
export function letterIndex(entries) {
  /** @type {Map<string, number>} */
  const index = new Map();
  entries.forEach((e, i) => {
    if (!index.has(e.initial)) index.set(e.initial, i);
  });
  return index;
}
