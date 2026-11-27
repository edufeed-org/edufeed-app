/**
 * Hashtag (`t` tag) normalization for every form that writes them (calendar,
 * article, wiki, forum thread, image license keywords).
 *
 * The case stays as typed: NIP-24 says `t` values SHOULD be lowercase, but
 * the calendar clients we checked (Plektos, Flockstr, Formstr, Coracle) keep
 * the typed spelling and most calendar events on public relays carry it, so
 * lowercasing only made our tags look wrong. In-app matching is
 * case-insensitive instead (CalendarView's tag filter).
 *
 * Dependency-free so it's safe to import anywhere (node tests, jsdom).
 */

/**
 * Normalize one hashtag: trim, strip leading `#`s. Returns '' for blank input.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeHashtag(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^#+/, '').trim();
}

/**
 * Normalize a hashtag list: normalize each, drop empties, dedupe
 * case-insensitively (the first spelling wins, first-seen order).
 *
 * @param {unknown} values
 * @returns {string[]}
 */
export function normalizeHashtags(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.map(normalizeHashtag).filter((tag) => {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Spellings of a tag to ask relays for: `#t` matches exactly, and tags exist
 * as typed, lowercased (NIP-24, our own older events) and capitalised.
 *
 * @param {string} tag
 * @returns {string[]}
 */
export function tagVariants(tag) {
  const lower = tag.toLowerCase();
  return [...new Set([tag, lower, lower.charAt(0).toUpperCase() + lower.slice(1)])];
}
