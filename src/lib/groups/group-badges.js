// The small labels on a group's home page.
//
// Two families, two sources — and neither is our own bookkeeping:
//   relayBadges   reads the relay's NIP-11 document (what the HOST does)
//   channelBadges reads the group's kind:39000 (what THIS group does)
//
// laoc asked for exactly this in round 1 of the design ("ein kleines Tag oder
// Label, um die unterscheiden zu können"), and Armada ships the same two
// families (ServerPage.tsx:88-97 and :181-183).
//
// Badges carry an `id`, never a finished string: the wording is i18n's job.
// The one exception is the software badge, whose text IS the relay's own
// self-description and must not be translated.

/**
 * @typedef {{id: string, text?: string}} Badge
 */

/**
 * What the relay says about itself. A NIP-11 document is untrusted network
 * input — every field is treated as possibly absent or the wrong shape.
 *
 * Only positive statements produce a badge. `auth_required: false` is a
 * statement too, but the badge for it would be the one label that could say
 * the opposite of the truth if the relay later changed its mind, so silence
 * is the honest rendering of "no, and nothing to announce".
 *
 * @param {{limitation?: {auth_required?: boolean}, supported_nips?: unknown, software?: unknown, version?: unknown} | null | undefined} info
 * @returns {Badge[]}
 */
export function relayBadges(info) {
  if (!info) return [];
  /** @type {Badge[]} */
  const badges = [];
  if (info.limitation?.auth_required === true) badges.push({ id: 'auth' });
  if (Array.isArray(info.supported_nips) && info.supported_nips.includes(29)) {
    badges.push({ id: 'nip29' });
  }
  const software = softwareName(info.software);
  if (software) {
    const version = typeof info.version === 'string' ? info.version.trim() : '';
    badges.push({ id: 'software', text: version ? `${software} ${version}` : software });
  }
  return badges;
}

/**
 * NIP-11 `software` is a URL by convention ("git+https://…/pyramid"), and the
 * last path segment is the name a reader recognises.
 * @param {unknown} value
 */
function softwareName(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.split('/').pop() ?? '';
}

/**
 * What THIS group's kind:39000 says about getting in.
 *
 * `closed` on top of `private` is deliberately NOT shown: a reader who cannot
 * read the group either way gains nothing from learning that joining also
 * needs an invitation, and on relays that couple the two switches (pyramid
 * rejects `private && !closed`) the second badge would appear on every
 * private group and mean nothing. Armada suppresses the same badge but keys
 * it on a hostname; this keys on whether the badge still carries information,
 * which needs no list of hosts.
 *
 * @param {{kind?: number, tags?: string[][]} | null | undefined} metadata
 * @returns {Badge[]}
 */
export function channelBadges(metadata) {
  if (!metadata || metadata.kind !== 39000 || !Array.isArray(metadata.tags)) return [];
  const has = (/** @type {string} */ name) => metadata.tags?.some((t) => t[0] === name) ?? false;
  if (has('private')) return [{ id: 'members' }];
  if (has('closed')) return [{ id: 'invite' }];
  return [];
}
