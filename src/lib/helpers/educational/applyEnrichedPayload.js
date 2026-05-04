/**
 * Apply an enriched-metadata payload from the `extract_metadata` MCP tool /
 * `amb-mcp/lib`'s `extractMetadata()` onto the wizard's `formData`.
 *
 * Conservative semantics: only fill fields the user hasn't touched. Strings
 * are filled when blank; SKOS arrays when empty; license when still the form
 * default. The AMB-JSON-LD source is skipped because the wizard already has
 * a richer prefill path for that case (`applyPrefillFromAmbEvent`).
 *
 * The payload uses `{id, prefLabel}` for SKOS concepts (per the lib's zod
 * schema). The wizard uses `{id, label}`. This helper performs the rename.
 */

const FORM_DEFAULT_LICENSE = 'https://creativecommons.org/licenses/by/4.0/';
const FORM_DEFAULT_LANGUAGE = 'de';

/**
 * @typedef {Object} ExtractMetadataResult
 * @property {'amb-jsonld' | 'llm-enriched' | 'opengraph-only'} source
 * @property {Record<string, unknown>} payload
 * @property {Record<string, string>} evidence
 * @property {{og?: Record<string, unknown>, amb?: Record<string, unknown>}} baseline
 */

/**
 * @param {Array<{id: string, prefLabel?: string}>} arr
 * @returns {Array<{id: string, label: string}>}
 */
function toFormConcepts(arr) {
  return arr.map((c) => ({ id: c.id, label: c.prefLabel ?? '' }));
}

/**
 * @template T
 * @param {T} formData - the wizard's reactive formData object
 * @param {ExtractMetadataResult | null | undefined} result
 * @returns {T} a new formData object with enriched values applied
 */
export function applyEnrichedPayload(formData, result) {
  const next = { ...formData };
  if (!result || result.source === 'amb-jsonld') return next;
  const payload = /** @type {Record<string, any>} */ (result.payload ?? {});

  if (typeof payload.name === 'string' && !next.name) next.name = payload.name;
  if (typeof payload.description === 'string' && !next.description) {
    next.description = payload.description;
  }
  if (typeof payload.image === 'string' && !next.image) next.image = payload.image;
  if (
    typeof payload.inLanguage === 'string' &&
    (!next.inLanguage || next.inLanguage === FORM_DEFAULT_LANGUAGE)
  ) {
    next.inLanguage = payload.inLanguage;
  }

  if (Array.isArray(payload.learningResourceType) && next.learningResourceType?.length === 0) {
    next.learningResourceType = toFormConcepts(payload.learningResourceType);
  }
  if (Array.isArray(payload.educationalLevels) && next.educationalLevels?.length === 0) {
    next.educationalLevels = toFormConcepts(payload.educationalLevels);
  }

  if (Array.isArray(payload.keywords) && next.keywords?.length === 0) {
    next.keywords = [...payload.keywords];
  }

  if (Array.isArray(payload.creators) && next.creators?.length === 0) {
    next.creators = payload.creators.map((c) => ({ ...c }));
  }

  if (typeof payload.license === 'string' && next.license === FORM_DEFAULT_LICENSE) {
    next.license = payload.license;
  }

  return next;
}
