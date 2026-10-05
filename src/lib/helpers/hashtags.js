/**
 * Hashtag (NIP-24 `t` tag) normalization for form inputs.
 *
 * NIP-24: `t` tag values SHOULD be lowercase. Matches `extractHashtags` in
 * text.js and the case-insensitive tag filter in CalendarView.
 *
 * Dependency-free so it's safe to import anywhere (node tests, jsdom).
 */

/**
 * Normalize one hashtag: trim, strip leading `#`s, lowercase.
 * Returns '' for blank input.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeHashtag(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^#+/, '').trim().toLowerCase();
}

/**
 * Normalize a hashtag list: normalize each, drop empties, dedupe (first-seen order).
 *
 * @param {unknown[] | null | undefined} values
 * @returns {string[]}
 */
export function normalizeHashtags(values) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(values.map((v) => normalizeHashtag(/** @type {string} */ (v))).filter(Boolean))
  ];
}
