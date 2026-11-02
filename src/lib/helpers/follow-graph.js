/**
 * Pure helpers for the follow graph shown on profiles ("N Follower ·
 * M Gefolgt", issue 891be310). Followers are the authors of contact lists
 * (kind 3) that p-tag a person — only the lists this client has loaded, so
 * every count is a lower bound; the list modal shows the same people.
 */

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Whom a contact list follows: each valid p-tag once, never the author.
 * @param {{ pubkey: string, tags: string[][] } | undefined | null} event
 * @returns {string[]}
 */
export function followingOf(event) {
  if (!event) return [];
  /** @type {Set<string>} insertion-ordered dedupe */
  const out = new Set();
  for (const t of event.tags) {
    if (t[0] === 'p' && HEX64.test(t[1] ?? '') && t[1] !== event.pubkey) out.add(t[1]);
  }
  return [...out];
}

/**
 * Who follows `subject`: authors of the given contact lists that p-tag it,
 * each once, never the subject itself.
 * @param {Iterable<{ pubkey: string, tags: string[][] }>} events
 * @param {string} subject
 * @returns {string[]}
 */
export function followersFrom(events, subject) {
  /** @type {Set<string>} insertion-ordered dedupe */
  const out = new Set();
  for (const event of events) {
    if (event.pubkey === subject || out.has(event.pubkey)) continue;
    if (event.tags.some((t) => t[0] === 'p' && t[1] === subject)) out.add(event.pubkey);
  }
  return [...out];
}

/**
 * People the viewer follows first, order kept inside both parts.
 * @param {string[]} pubkeys
 * @param {string[]} viewerFollows
 * @returns {string[]}
 */
export function knownFirst(pubkeys, viewerFollows) {
  const mine = new Set(viewerFollows);
  return [...pubkeys.filter((pk) => mine.has(pk)), ...pubkeys.filter((pk) => !mine.has(pk))];
}
