/**
 * Unicode emoji data — the pure half. The datasets under src/lib/data/emoji/
 * are generated per app locale by scripts/generate-emoji-data.mjs (emojibase:
 * Unicode 17, CLDR labels + keywords in the locale's language, English
 * shortcodes). They load lazily, one ~60 KB chunk per locale, so nothing
 * here touches the root layout's preload budget. The reactive side (current
 * locale, chosen skin tone) lives in stores/emoji-data.svelte.js.
 */

/**
 * @typedef {{ u: string, g: number, l: string, t: string[], s: string[], k?: string[] }} EmojiEntry
 *   u wire form, g emojibase group, l localized label, t localized keywords,
 *   s English shortcodes, k skin-tone variants light…dark (5) when uniform
 */

/** Picker section order — emojibase group numbers (2 = components is skipped). */
export const EMOJI_GROUP_ORDER = [0, 1, 3, 4, 5, 6, 7, 8, 9];

/** Skin tone 0 = none (yellow), 1…5 = light…dark (Fitzpatrick modifier order). */
export const SKIN_TONES = [0, 1, 2, 3, 4, 5];

const modules = import.meta.glob('../data/emoji/*.json', { import: 'default' });

/** @type {Map<string, Promise<EmojiEntry[]>>} */
const cache = new Map();

/**
 * The dataset locale for an app locale — falls back to English when no
 * dataset was generated for it.
 * @param {string | undefined} locale
 */
export function emojiDataLocale(locale) {
  const short = (locale ?? '').toLowerCase().split('-')[0];
  return `../data/emoji/${short}.json` in modules ? short : 'en';
}

/**
 * Load (once) the dataset for a locale.
 * @param {string} locale
 * @returns {Promise<EmojiEntry[]>}
 */
export function loadEmojiData(locale) {
  const key = emojiDataLocale(locale);
  let pending = cache.get(key);
  if (!pending) {
    pending = /** @type {Promise<EmojiEntry[]>} */ (modules[`../data/emoji/${key}.json`]());
    cache.set(key, pending);
  }
  return pending;
}

/**
 * Query normalisation shared by the picker and the `:` autocomplete: case
 * folded, `_` reads as a space so `:daumen_hoch` finds "Daumen hoch".
 * @param {string} query
 */
export function normalizeEmojiQuery(query) {
  return query.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * How well an entry matches a normalised query: 0 exact keyword, 1 keyword
 * starts with it, 2 a later word inside a keyword starts with it, 3
 * substring, -1 no match. Keywords are the shortcodes (with `_` as space),
 * the label and the tags.
 * @param {EmojiEntry} entry
 * @param {string} q normalised
 */
export function matchEmojiEntry(entry, q) {
  let best = -1;
  const keywords = [...entry.s.map((s) => s.replace(/_/g, ' ')), entry.l, ...entry.t];
  for (const keyword of keywords) {
    const k = keyword.toLowerCase();
    let rank = -1;
    if (k === q) rank = 0;
    else if (k.startsWith(q)) rank = 1;
    else if (k.includes(` ${q}`)) rank = 2;
    else if (k.includes(q)) rank = 3;
    if (rank !== -1 && (best === -1 || rank < best)) best = rank;
    if (best === 0) break;
  }
  return best;
}

/**
 * Rank the dataset against a query: exact matches, then keyword prefix,
 * then inner-word prefix, then substring; ties keep emojibase order. Empty query → nothing.
 * @param {string} query raw user input
 * @param {EmojiEntry[]} entries
 * @param {number} [limit]
 * @returns {EmojiEntry[]}
 */
export function searchUnicodeEmojis(query, entries, limit = Infinity) {
  const q = normalizeEmojiQuery(query);
  if (!q) return [];
  /** @type {Array<{ rank: number, entry: EmojiEntry }>} */
  const hits = [];
  for (const entry of entries) {
    const rank = matchEmojiEntry(entry, q);
    if (rank !== -1) hits.push({ rank, entry });
  }
  hits.sort((a, b) => a.rank - b.rank);
  return hits.slice(0, limit).map((h) => h.entry);
}

/**
 * The emoji to insert for a chosen skin tone — the base form when the tone
 * is 0 or the emoji has no tone variants.
 * @param {EmojiEntry} entry
 * @param {number} tone 0…5
 */
export function withSkinTone(entry, tone) {
  if (tone > 0 && entry.k) return entry.k[tone - 1] ?? entry.u;
  return entry.u;
}
