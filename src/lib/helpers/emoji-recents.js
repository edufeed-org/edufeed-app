/**
 * "Recently used" emojis — the pure half. A most-recent-first list, unique
 * per emoji, capped at RECENT_LIMIT (three picker rows). Unicode entries keep
 * the BASE emoji (no skin tone) so the row re-applies whatever tone the user
 * has chosen now; custom NIP-30 entries keep shortcode + url so they still
 * render after their pack is gone. Persisted per device and account by
 * stores/emoji-data.svelte.js; this module never touches storage.
 */

export const RECENT_LIMIT = 24;

/**
 * @typedef {{ type: 'unicode', u: string }
 *   | { type: 'custom', shortcode: string, url: string }} RecentEmoji
 */

/** @param {RecentEmoji} item */
export function recentKey(item) {
  return item.type === 'unicode' ? `u:${item.u}` : `c:${item.shortcode}`;
}

/**
 * Move (or add) an emoji to the front of the list.
 * @param {RecentEmoji[]} list
 * @param {RecentEmoji} item
 * @param {number} [limit]
 * @returns {RecentEmoji[]}
 */
export function pushRecent(list, item, limit = RECENT_LIMIT) {
  const key = recentKey(item);
  return [item, ...list.filter((other) => recentKey(other) !== key)].slice(0, limit);
}

/** @param {unknown} item @returns {item is RecentEmoji} */
function isRecent(item) {
  if (!item || typeof item !== 'object') return false;
  const it = /** @type {Record<string, unknown>} */ (item);
  if (it.type === 'unicode') return typeof it.u === 'string' && it.u.length > 0;
  if (it.type === 'custom') {
    return (
      typeof it.shortcode === 'string' &&
      /^[\w+-]+$/.test(it.shortcode) &&
      typeof it.url === 'string' &&
      /^https?:\/\//.test(it.url)
    );
  }
  return false;
}

/**
 * Parse the stored JSON, dropping anything malformed (storage is untrusted:
 * older versions, manual edits, other tabs) and duplicate entries.
 * @param {string | null | undefined} raw
 * @returns {RecentEmoji[]}
 */
export function parseRecents(raw) {
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  /** @type {RecentEmoji[]} */
  const out = [];
  const seen = new Set();
  for (const item of data) {
    if (!isRecent(item)) continue;
    const key = recentKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      item.type === 'unicode'
        ? { type: 'unicode', u: item.u }
        : { type: 'custom', shortcode: item.shortcode, url: item.url }
    );
    if (out.length === RECENT_LIMIT) break;
  }
  return out;
}
