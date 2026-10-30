/**
 * Pure helpers for the deployment's NIP-05 member directory — the full
 * `https://<NIP05_HANDLE_DOMAIN>/.well-known/nostr.json` (no `?name=`), which
 * edufeed's nip-05 service answers with every handle. Membership counts only
 * through that file: anyone can write "@edufeed.org" into their own profile.
 */

/**
 * Every valid pubkey of a directory's `names` map, lowercased, each once.
 * @param {unknown} json
 * @returns {string[]}
 */
export function parseDirectoryMembers(json) {
  const names = /** @type {any} */ (json)?.names;
  if (!names || typeof names !== 'object') return [];
  /** @type {Set<string>} insertion-ordered dedupe */
  const out = new Set();
  for (const value of Object.values(names)) {
    if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)) out.add(value.toLowerCase());
  }
  return [...out];
}

/**
 * Split an already ranked list into the members and everyone else, keeping
 * the order inside each part.
 * @template {{pubkey: string}} T
 * @param {T[]} list
 * @param {Set<string>} members
 * @returns {{members: T[], others: T[]}}
 */
export function membersFirst(list, members) {
  /** @type {T[]} */
  const inside = [];
  /** @type {T[]} */
  const others = [];
  for (const item of list) (members.has(item.pubkey) ? inside : others).push(item);
  return { members: inside, others };
}
