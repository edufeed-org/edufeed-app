/**
 * Pure helpers backing rich link rendering in NostrContentRenderer.
 * Kept free of SvelteKit / applesauce imports so they can be unit-tested in a
 * node environment without dragging in the whole nostr infrastructure chain.
 */

const NOSTR_ID_RE = /(?:nostr:)?(npub|nprofile|note|nevent|naddr)1[a-z0-9]+/i;

// Matches a NIP-19 id optionally wrapped in a URL (e.g. an app link like
// `http://localhost:5173/naddr1…`) or a `nostr:` URI. The leading URL prefix is
// consumed so the whole token is replaced by the preview card, not left dangling.
const URL_OR_NOSTR_ID_RE =
  /(?:https?:\/\/\S*?)?(?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+/gi;

/**
 * Pull a bare NIP-19 identifier out of an app URL (or a `nostr:` URI) so the
 * link can render as a preview card instead of a giant raw anchor. Strips any
 * `nostr:` prefix. Returns null when the URL carries no nostr identifier.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function nostrIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(NOSTR_ID_RE);
  if (!match) return null;
  return match[0].replace(/^nostr:/i, '');
}

/**
 * @typedef {{ text: string } | { id: string }} NostrSegment
 */

/**
 * Split free text into plain-text and nostr-id segments. A NIP-19 id is matched
 * even when it is embedded in a URL the content parser failed to linkify (e.g.
 * a `localhost` app link with no TLD), and the surrounding URL is consumed so it
 * can be replaced by a preview card rather than rendered as raw text.
 *
 * @param {string} text
 * @returns {NostrSegment[]}
 */
export function splitNostrIds(text) {
  if (!text) return [{ text: text ?? '' }];
  /** @type {NostrSegment[]} */
  const segments = [];
  let lastIndex = 0;
  URL_OR_NOSTR_ID_RE.lastIndex = 0;
  let match;
  while ((match = URL_OR_NOSTR_ID_RE.exec(text)) !== null) {
    const id = nostrIdFromUrl(match[0]);
    if (!id) continue;
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index) });
    segments.push({ id });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
  return segments.length ? segments : [{ text }];
}

/**
 * Shorten long display text, keeping the head and tail with an ellipsis in the
 * middle. Strings at or under `max` are returned unchanged.
 *
 * @param {string} str
 * @param {number} [max=42]
 * @returns {string}
 */
export function truncateMiddle(str, max = 42) {
  if (!str || str.length <= max) return str;
  const keep = max - 1; // room for the ellipsis
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${str.slice(0, head)}…${str.slice(str.length - tail)}`;
}
