/**
 * NIP-50 Search Query Builder for Educational Content
 *
 * Builds search query strings compatible with the AMB Typesense relay.
 * Supports free-text search and field-specific filtering using dot notation.
 */

/**
 * @typedef {Object} ExtFieldValue
 * @property {string} [id] - Concept URI (for vocab-bound ext fields)
 * @property {string} [value] - Scalar value (for free-form ext fields)
 */

/**
 * @typedef {Object} SearchFilters
 * @property {string} [searchText] - Free-text search query
 * @property {Array<{id: string, prefLabel: Object<string, string>}>} [learningResourceType] - Selected resource types
 * @property {Array<{id: string, prefLabel: Object<string, string>}>} [about] - Selected subjects/topics
 * @property {Array<{id: string, prefLabel: Object<string, string>}>} [audience] - Selected target audiences
 * @property {Record<string, ExtFieldValue[]>} [extFields] - Form-driven ext fields, keyed "<ns>:<facet>" — the NIP-AMB grammar, where a form-driven field serializes with ns = the form's d-tag and facet = the field id (see formValuesToAmbJson.js)
 */

/**
 * @typedef {Object} SearchFilterObject
 * @property {string} search - NIP-50 search string
 * @property {Record<string, string[]>} tagFilters - Multi-letter `#ext:<ns>:<facet>[:id]` tag filters, the exact-match mechanism for ext facets
 */

/**
 * Escape special characters in search values for NIP-50 queries
 * @param {string} value - The value to escape
 * @returns {string} Escaped value
 */
function escapeSearchValue(value) {
  // Only escape double quotes - colons in URLs should NOT be escaped
  // The field:value separator uses the first colon, remaining colons are part of the value
  return value.replace(/"/g, '\\"');
}

/**
 * Convert an ext filter key into the event tag key that `formValuesToAmbJson.js`
 * + `ambToNostr` actually write: `ext:<ns>:<facet>`.
 *
 * Returns null for anything that is not exactly two non-empty segments. The
 * NIP-AMB grammar is left-anchored with fixed arity — `ns` and `facet` MUST NOT
 * contain `:` (see `parseTagKey()` in parseExtensionTags.js) — so a surplus-
 * segment key like the pre-migration `30168:<pub>:<d>:<fieldId>` has no valid
 * reading. Callers must **skip** such a key rather than emit a filter from it:
 * a malformed filter matches nothing, which reads to the user as "no results"
 * instead of "this filter is broken".
 *
 * @param {string} extKey
 * @returns {string | null}
 */
function extPathToTagKey(extKey) {
  const segments = (extKey ?? '').split(':');
  if (segments.length !== 2) return null;
  const [ns, facet] = segments;
  if (!ns || !facet) return null;
  return `ext:${ns}:${facet}`;
}

/**
 * Build a NIP-50 search query string from filters
 *
 * @param {SearchFilters} filters - The search filters
 * @returns {string} The NIP-50 compatible search query string
 *
 * @example
 * // Free-text only
 * buildSearchQuery({ searchText: 'mathematik' })
 * // Returns: "mathematik"
 *
 * @example
 * // With filters
 * buildSearchQuery({
 *   searchText: 'bildung',
 *   learningResourceType: [{ id: 'https://w3id.org/kim/hcrt/video' }],
 *   about: [{ id: 'http://w3id.org/kim/hochschulfaechersystematik/n079' }]
 * })
 * // Returns: "bildung learningResourceType.id:https://w3id.org/kim/hcrt/video about.id:http://w3id.org/kim/hochschulfaechersystematik/n079"
 */
export function buildSearchQuery(filters) {
  const parts = [];

  // Add free-text search
  if (filters.searchText?.trim()) {
    parts.push(filters.searchText.trim());
  }

  // Add learningResourceType filters
  if (filters.learningResourceType && filters.learningResourceType.length > 0) {
    filters.learningResourceType.forEach((concept) => {
      if (concept.id) {
        parts.push(`learningResourceType.id:${escapeSearchValue(concept.id)}`);
      }
    });
  }

  // Add about (subject) filters
  if (filters.about && filters.about.length > 0) {
    filters.about.forEach((concept) => {
      if (concept.id) {
        parts.push(`about.id:${escapeSearchValue(concept.id)}`);
      }
    });
  }

  // Add audience filters
  if (filters.audience && filters.audience.length > 0) {
    filters.audience.forEach((concept) => {
      if (concept.id) {
        parts.push(`audience.id:${escapeSearchValue(concept.id)}`);
      }
    });
  }

  // Ext facets are deliberately absent from the NIP-50 `search` string. They
  // used to be emitted as a dot path (`ext.<ns>.<facet>.id:<uri>`), which is
  // not merely wrong but unrepairable: with reverse-DNS namespaces
  // `ext.org.edufeed.ekw.konfi.themen.id` gives no way to tell where the
  // namespace ends and the facet begins. `buildSearchFilterObject` carries
  // them as exact-match `#ext:<ns>:<facet>` tag filters instead, which is what
  // the relay indexes.

  return parts.join(' ');
}

/**
 * Build a search filter object: the NIP-50 `search` string for AMB-core
 * fields, plus exact-match multi-letter `#ext:<ns>:<facet>[:id]` tag filters
 * for form-driven ext facets. Callers merge the returned object into their
 * pool.request filter.
 *
 * Ext facets travel only as tag filters — see the note in `buildSearchQuery`
 * for why the dot-path variant was removed rather than repaired.
 *
 * @param {SearchFilters} filters
 * @returns {SearchFilterObject}
 */
export function buildSearchFilterObject(filters) {
  const search = buildSearchQuery(filters);
  /** @type {Record<string, string[]>} */
  const tagFilters = {};

  if (filters.extFields) {
    for (const [extKey, values] of Object.entries(filters.extFields)) {
      if (!Array.isArray(values)) continue;
      const tagKeyBase = extPathToTagKey(extKey);
      // Malformed key — emit nothing rather than a filter that cannot match.
      if (!tagKeyBase) continue;
      for (const entry of values) {
        if (entry?.id) {
          const key = `#${tagKeyBase}:id`;
          if (!tagFilters[key]) tagFilters[key] = [];
          tagFilters[key].push(entry.id);
        } else if (entry?.value) {
          const key = `#${tagKeyBase}`;
          if (!tagFilters[key]) tagFilters[key] = [];
          tagFilters[key].push(entry.value);
        }
      }
    }
  }

  return { search, tagFilters };
}

/**
 * Check if any search filters are active
 * @param {SearchFilters} filters - The search filters
 * @returns {boolean} True if any filter is active
 */
export function hasActiveFilters(filters) {
  return !!(
    filters.searchText?.trim() ||
    (filters.learningResourceType && filters.learningResourceType.length > 0) ||
    (filters.about && filters.about.length > 0) ||
    (filters.audience && filters.audience.length > 0) ||
    hasActiveExtFilters(filters.extFields)
  );
}

/**
 * @param {Record<string, ExtFieldValue[]> | undefined} extFields
 * @returns {boolean}
 */
function hasActiveExtFilters(extFields) {
  if (!extFields) return false;
  for (const values of Object.values(extFields)) {
    if (Array.isArray(values) && values.some((v) => v?.id || v?.value)) return true;
  }
  return false;
}

/**
 * Create an empty filters object
 * @returns {SearchFilters} Empty filters
 */
export function createEmptyFilters() {
  return {
    searchText: '',
    learningResourceType: [],
    about: [],
    audience: [],
    extFields: {}
  };
}
