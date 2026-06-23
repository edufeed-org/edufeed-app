/**
 * Candidate OER sources for the image picker's "search libraries" section.
 * Hardcoded (KISS): the set rarely changes per deployment, and the proxy's
 * ENABLED_ADAPTERS is the real availability source of truth. `checked` marks
 * which sources are queried by default. ALLOWED_OER_SOURCE_IDS is also the
 * allowlist `/api/oer` validates the `sources` param against, so only these
 * IDs are ever forwarded to the upstream proxy.
 */

/** @typedef {{ id: string, label: string, checked: boolean }} OerSource */

/** @type {OerSource[]} */
export const OER_SOURCES = [
  { id: 'openverse', label: 'Openverse', checked: true },
  { id: 'unsplash', label: 'Unsplash', checked: true },
  { id: 'wikimedia', label: 'Wikimedia Commons', checked: true },
  { id: 'arasaac', label: 'ARASAAC', checked: false }
];

/** Set of allowed source IDs — validates the /api/oer `sources` param. */
export const ALLOWED_OER_SOURCE_IDS = new Set(OER_SOURCES.map((s) => s.id));

/**
 * Parse a comma-separated `sources` string into a list of allowed source IDs.
 * Unknown IDs and duplicates are dropped. Empty / missing input falls back to
 * the default-checked sources so a bare search still queries something.
 * @param {string | null | undefined} csv
 * @returns {string[]}
 */
export function parseRequestedSources(csv) {
  if (typeof csv !== 'string' || csv.trim() === '') {
    return OER_SOURCES.filter((s) => s.checked).map((s) => s.id);
  }
  const requested = csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((id) => ALLOWED_OER_SOURCE_IDS.has(id));
  return [...new Set(requested)];
}
