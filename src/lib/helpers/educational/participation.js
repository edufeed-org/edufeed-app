/**
 * "Beteiligt an" — content by others that names a profile as creator or
 * contributor through a NIP-AMB p-tag:
 *   `["p", <pubkey-hex>, <relay-hint>, "creator" | "contributor"]`
 * On resources (kind 30142) a missing marker counts as creator (events written
 * before markers). On articles (kind 30023) an unmarked p tag is a NIP-27 body
 * mention, never a credit. Any other marker is a mention on both.
 */

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const AMB_KIND = 30142;
const ARTICLE_KIND = 30023;

/**
 * @param {{ kind?: number, tags?: string[][] } | null | undefined} event
 * @param {string} pubkey - hex
 * @returns {'creator' | 'contributor' | null}
 */
export function getParticipationRole(event, pubkey) {
  if (!event || !pubkey || (event.kind !== AMB_KIND && event.kind !== ARTICLE_KIND)) return null;
  const wanted = pubkey.toLowerCase();
  for (const t of event.tags || []) {
    if (t[0] !== 'p' || !HEX_PUBKEY.test(t[1] || '') || t[1].toLowerCase() !== wanted) continue;
    const marker = t[3] || (event.kind === AMB_KIND ? 'creator' : '');
    if (marker === 'creator' || marker === 'contributor') return marker;
  }
  return null;
}

/**
 * Relay filter for everything of one kind a profile participates in.
 * @param {string} pubkey - hex
 * @param {number} [kind] - 30142 (default) or 30023
 */
export function participationFilter(pubkey, kind = AMB_KIND) {
  return { kinds: [kind], '#p': [pubkey] };
}
