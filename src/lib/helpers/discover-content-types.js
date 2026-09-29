/**
 * Discover page content-type configuration.
 *
 * A deployment chooses which content types /discover offers via the
 * `DISCOVER_CONTENT_TYPES` env var (exposed as `runtimeConfig.discover.contentTypes`).
 * The synthetic "All" tab is never configured directly: it is derived here and
 * merges the enabled FEED types (events, learning, articles, boards) into one
 * timeline. Communities and people have their own list UIs and are never part
 * of "All".
 */

/** Every configurable content type, in canonical tab order. */
export const DISCOVER_CONTENT_TYPES = Object.freeze([
  'events',
  'learning',
  'articles',
  'boards',
  'communities',
  'people'
]);

/** Content types that are merged into the "All" feed. */
export const DISCOVER_FEED_TYPES = Object.freeze(['events', 'learning', 'articles', 'boards']);

/**
 * Normalize a configured list of content types: split a comma-separated string,
 * trim + lowercase, drop unknown tokens (including the synthetic `all`), dedupe,
 * and return them in canonical order. An empty result (unset var, or only
 * unknown tokens) yields every type so a misconfiguration never blanks the page.
 *
 * @param {string | string[] | undefined | null} value
 * @returns {string[]}
 */
export function parseDiscoverContentTypes(value) {
  const tokens = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const wanted = new Set(
    tokens.map((t) => String(t).trim().toLowerCase()).filter((t) => t.length > 0)
  );
  const enabled = DISCOVER_CONTENT_TYPES.filter((t) => wanted.has(t));
  return enabled.length > 0 ? enabled : [...DISCOVER_CONTENT_TYPES];
}

/**
 * Tabs to render for a set of enabled content types. "All" leads whenever it
 * would merge at least two feed types; with fewer it would only duplicate a
 * single tab (or be empty), so it is omitted.
 *
 * @param {readonly string[]} enabled
 * @returns {string[]}
 */
export function getDiscoverTabs(enabled) {
  const feedCount = DISCOVER_FEED_TYPES.filter((t) => enabled.includes(t)).length;
  return feedCount >= 2 ? ['all', ...enabled] : [...enabled];
}

/**
 * Resolve a requested tab (e.g. from `?type=`) against the rendered tabs.
 * Unknown, missing or disabled values fall back to the first tab.
 *
 * @param {string | null | undefined} requested
 * @param {readonly string[]} tabs
 * @returns {string}
 */
export function resolveDiscoverType(requested, tabs) {
  if (requested && tabs.includes(requested)) return requested;
  return tabs[0];
}

/**
 * @param {string} type
 * @param {readonly string[]} enabled
 * @returns {boolean}
 */
export function isDiscoverTypeEnabled(type, enabled) {
  return enabled.includes(type);
}
