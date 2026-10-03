// Call reactions on the wire (LiveKit data, topic "edufeed.call"):
//   { t: 'react', e: <emoji>, n: <nonce> }                       unicode
//   { t: 'react', e: ':code:', n, custom: { shortcode, url } }   NIP-30 custom
// Older clients only accept `e` from their fixed quick list, so they simply
// skip anything else (a custom `:code:` included) — nothing breaks.

const MAX_EMOJI_LENGTH = 32; // UTF-16 units: long ZWJ sequences + tag flags fit
const MAX_URL_LENGTH = 1024;
const SHORTCODE = /^[A-Za-z0-9_-]{1,64}$/;
// Only emoji code points (pictographs, regional indicators, modifiers, ZWJ,
// variation selectors, keycap/tag parts) — no letters, spaces or markup.
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Presentation})+$/u;
const HAS_PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/**
 * One unicode emoji (sequence) and nothing else.
 * @param {unknown} e
 */
export function isReactionEmoji(e) {
  return (
    typeof e === 'string' &&
    e.length > 0 &&
    e.length <= MAX_EMOJI_LENGTH &&
    EMOJI_ONLY.test(e) &&
    HAS_PICTURE.test(e)
  );
}

/**
 * A NIP-30 custom emoji fit to render for everyone: shortcode of letters,
 * digits, `_` and `-`; an https image URL of bounded length.
 * @param {unknown} c
 * @returns {{ shortcode: string, url: string } | null}
 */
export function normalizeCustomEmoji(c) {
  if (!c || typeof c !== 'object') return null;
  const { shortcode, url } = /** @type {{ shortcode?: unknown, url?: unknown }} */ (c);
  if (typeof shortcode !== 'string' || !SHORTCODE.test(shortcode)) return null;
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { shortcode, url };
}

/** @param {unknown} n */
const isNonce = (n) => typeof n === 'string' && n.length > 0 && n.length <= 32;

/**
 * The data message for a reaction, or null when it is not one we send.
 * @param {string | { shortcode: string, url: string }} emoji
 * @param {string} nonce
 */
export function reactionPayload(emoji, nonce) {
  if (typeof emoji === 'string') {
    return isReactionEmoji(emoji) ? { t: 'react', e: emoji, n: nonce } : null;
  }
  const custom = normalizeCustomEmoji(emoji);
  return custom ? { t: 'react', e: `:${custom.shortcode}:`, n: nonce, custom } : null;
}

/**
 * A received reaction, validated; unknown extra fields are ignored.
 * @param {any} msg
 * @returns {{ emoji: string, url?: string, nonce: string } | null}
 */
export function parseReactionPayload(msg) {
  if (msg?.t !== 'react' || !isNonce(msg.n)) return null;
  if (msg.custom !== undefined) {
    const custom = normalizeCustomEmoji(msg.custom);
    if (!custom || msg.e !== `:${custom.shortcode}:`) return null;
    return { emoji: msg.e, url: custom.url, nonce: msg.n };
  }
  return isReactionEmoji(msg.e) ? { emoji: msg.e, nonce: msg.n } : null;
}
