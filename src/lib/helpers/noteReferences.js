/**
 * Note composer reference helpers (issue #36).
 * Validate pasted NIP-19 identifiers / nostr: URIs / wrapping URLs and
 * insert them into draft content as `nostr:` references, which the feed
 * renders as embedded cards (NostrContentRenderer → NostrIdentifier).
 */
import { nip19 } from 'nostr-tools';
import { nostrIdFromUrl } from '$lib/helpers/link-render.js';

// nsec is excluded by construction (nostrIdFromUrl never matches it, and the
// allow-list here rejects it for bare pastes).
const ALLOWED_TYPES = new Set(['note', 'nevent', 'naddr', 'npub', 'nprofile']);

/**
 * Parse a pasted identifier, nostr: URI, or URL containing one into a
 * validated reference token.
 * @param {string} raw
 * @returns {{ type: string, encoded: string } | null}
 */
export function parseReferenceToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const stripped = nostrIdFromUrl(trimmed) ?? trimmed.replace(/^nostr:/i, '');
  try {
    const decoded = nip19.decode(stripped);
    if (!ALLOWED_TYPES.has(decoded.type)) return null;
    return { type: decoded.type, encoded: stripped };
  } catch {
    return null;
  }
}

/**
 * @param {{ encoded: string }} token
 * @returns {string}
 */
export function buildReferenceUri(token) {
  return `nostr:${token.encoded}`;
}

/**
 * Append a reference URI to draft content on its own paragraph.
 * @param {string} content
 * @param {string} uri
 * @returns {string}
 */
export function insertReferenceIntoContent(content, uri) {
  if (!content.trim()) return uri;
  return (content.endsWith('\n') ? content : content + '\n\n') + uri;
}
