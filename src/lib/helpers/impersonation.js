/**
 * Impersonation-warning helpers — find verified profiles whose name matches
 * an unverified profile, so visitors can spot look-alike accounts.
 */

/**
 * Canonical form for name comparison: lowercase, diacritics stripped,
 * punctuation/whitespace collapsed to single spaces.
 * @param {string | null | undefined} name
 * @returns {string}
 */
export function normalizeProfileName(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Two names are similar when their normalized forms are equal or one
 * contains the other. Names shorter than 3 characters never match.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function isSimilarName(a, b) {
  const na = normalizeProfileName(a);
  const nb = normalizeProfileName(b);
  if (na.length < 3 || nb.length < 3) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Turn kind-0 search results into impersonation-match candidates:
 * similarly named, carrying a nip05, not the profile itself.
 * Deduped by pubkey (newest created_at wins), capped.
 *
 * @param {Array<{ pubkey: string, created_at?: number, content: string }>} kind0Events
 * @param {string} targetName
 * @param {string} targetPubkey
 * @param {number} [cap=5]
 * @returns {Array<{ pubkey: string, name: string, nip05: string, picture?: string }>}
 */
export function rankImpersonationCandidates(kind0Events, targetName, targetPubkey, cap = 5) {
  if (!targetName || normalizeProfileName(targetName).length < 3) return [];

  /** @type {Map<string, { event: any, profile: any }>} */
  const byPubkey = new Map();
  for (const event of kind0Events || []) {
    if (!event?.pubkey || event.pubkey === targetPubkey) continue;
    let profile;
    try {
      profile = JSON.parse(event.content);
    } catch {
      continue;
    }
    const existing = byPubkey.get(event.pubkey);
    if (!existing || (event.created_at ?? 0) > (existing.event.created_at ?? 0)) {
      byPubkey.set(event.pubkey, { event, profile });
    }
  }

  const candidates = [];
  for (const [pubkey, { profile }] of byPubkey) {
    const name = profile?.name || profile?.display_name;
    if (!name || !profile?.nip05) continue;
    if (!isSimilarName(targetName, name)) continue;
    candidates.push({ pubkey, name, nip05: profile.nip05, picture: profile.picture });
    if (candidates.length >= cap) break;
  }
  return candidates;
}
