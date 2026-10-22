/**
 * "Beteiligt an" — resources (kind 30142) that name a profile as creator or
 * contributor through a NIP-AMB p-tag:
 *   `["p", <pubkey-hex>, <relay-hint>, "creator" | "contributor"]`
 * A missing marker counts as creator (events written before markers); any
 * other marker is a mention and does not make the profile a participant.
 */

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const AMB_KIND = 30142;

/**
 * @param {{ kind?: number, tags?: string[][] } | null | undefined} event
 * @param {string} pubkey - hex
 * @returns {'creator' | 'contributor' | null}
 */
export function getParticipationRole(event, pubkey) {
  if (!event || event.kind !== AMB_KIND || !pubkey) return null;
  const wanted = pubkey.toLowerCase();
  for (const t of event.tags || []) {
    if (t[0] !== 'p' || !HEX_PUBKEY.test(t[1] || '') || t[1].toLowerCase() !== wanted) continue;
    const marker = t[3] || 'creator';
    if (marker === 'creator' || marker === 'contributor') return marker;
  }
  return null;
}

/**
 * Relay filter for everything a profile participates in.
 * @param {string} pubkey - hex
 */
export function participationFilter(pubkey) {
  return { kinds: [AMB_KIND], '#p': [pubkey] };
}
