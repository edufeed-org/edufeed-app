// Pure half of the Slack-style `:` emoji autocomplete used by EmojiInput
// (laoc, 2026-09-18): detect an in-progress `:query` before the caret, rank
// matches from the user's custom packs (NIP-30, kind 30030) and the unicode
// set, splice the pick into the text, and list the custom emojis a draft
// still references (the send paths turn those into `emoji` tags). Mirrors
// concord/chat-helpers.js's detectMentionQuery/applyMention so both
// autocompletes feel the same. No Svelte/store imports — trivially testable.
import { emojiMetadata } from '$lib/data/emojiMetadata.js';

/** @typedef {{ shortcode: string, url: string }} CustomEmoji */
/** @typedef {{ packName: string, emojis: CustomEmoji[] }} EmojiPack */
/**
 * @typedef {{ type: 'custom', shortcode: string, url: string, packName: string }
 *   | { type: 'unicode', char: string, name: string }} EmojiHit
 */

const SHORTCODE_CHARS = /^[\w+-]+$/;

/**
 * Detect an in-progress `:query` immediately before the caret. The colon
 * must sit at the text start or after whitespace (so "12:30" and URLs never
 * trigger), the query needs at least two shortcode characters and no
 * closing colon yet.
 * @param {string} text
 * @param {number} caret
 * @returns {{ start: number, query: string } | null}
 */
export function detectEmojiQuery(text, caret) {
  const upToCaret = text.slice(0, caret);
  const colon = upToCaret.lastIndexOf(':');
  if (colon === -1) return null;
  if (colon > 0 && !/\s/.test(upToCaret[colon - 1])) return null;
  const query = upToCaret.slice(colon + 1);
  if (query.length < 2 || !SHORTCODE_CHARS.test(query)) return null;
  return { start: colon, query };
}

/**
 * Rank matches for a query: the user's own custom emojis first (prefix
 * matches before substring matches, shorter shortcodes first), then unicode
 * emojis by keyword the same way. Case-insensitive, bounded by `limit`.
 * @param {string} query
 * @param {EmojiPack[]} customSets
 * @param {number} [limit]
 * @returns {EmojiHit[]}
 */
export function searchEmojis(query, customSets, limit = 8) {
  const q = query.toLowerCase();
  if (!q) return [];
  /** @type {Array<{ rank: number, hit: EmojiHit }>} */
  const custom = [];
  for (const pack of customSets ?? []) {
    for (const emoji of pack.emojis ?? []) {
      const sc = emoji.shortcode.toLowerCase();
      const rank = sc.startsWith(q) ? 0 : sc.includes(q) ? 1 : -1;
      if (rank === -1) continue;
      custom.push({
        rank: rank * 1000 + sc.length,
        hit: { type: 'custom', shortcode: emoji.shortcode, url: emoji.url, packName: pack.packName }
      });
    }
  }
  /** @type {Array<{ rank: number, hit: EmojiHit }>} */
  const unicode = [];
  for (const [char, keywords] of Object.entries(emojiMetadata)) {
    let best = -1;
    for (const keyword of keywords) {
      const k = keyword.toLowerCase();
      const rank = k.startsWith(q) ? 0 : k.includes(q) ? 1 : -1;
      if (rank !== -1 && (best === -1 || rank < best)) best = rank;
    }
    if (best === -1) continue;
    unicode.push({ rank: best, hit: { type: 'unicode', char, name: keywords[0] } });
  }
  const byRank = (/** @type {{rank: number}} */ a, /** @type {{rank: number}} */ b) =>
    a.rank - b.rank;
  custom.sort(byRank);
  unicode.sort(byRank);
  return [...custom, ...unicode].slice(0, limit).map((entry) => entry.hit);
}

/**
 * Replace the `:query` span with the pick. A space follows unless the text
 * after the caret already starts with whitespace (no double spaces when the
 * pick lands mid-sentence). The caret is a UTF-16 offset, like
 * selectionStart: a surrogate-pair emoji counts as two.
 * @param {string} text
 * @param {number} start index of the colon
 * @param {number} caret end of the query
 * @param {string} inserted `:shortcode:` or the unicode character
 * @returns {{ text: string, caret: number }}
 */
export function applyEmoji(text, start, caret, inserted) {
  const rest = text.slice(caret);
  const piece = /^\s/.test(rest) ? inserted : `${inserted} `;
  return { text: text.slice(0, start) + piece + rest, caret: start + piece.length };
}

/**
 * The custom emojis a text still references as `:shortcode:`, once each.
 * @param {string} text
 * @param {EmojiPack[]} customSets
 * @returns {CustomEmoji[]}
 */
export function customEmojisIn(text, customSets) {
  /** @type {Map<string, CustomEmoji>} */
  const found = new Map();
  for (const pack of customSets ?? []) {
    for (const emoji of pack.emojis ?? []) {
      if (!found.has(emoji.shortcode) && text.includes(`:${emoji.shortcode}:`)) {
        found.set(emoji.shortcode, { shortcode: emoji.shortcode, url: emoji.url });
      }
    }
  }
  return [...found.values()];
}
