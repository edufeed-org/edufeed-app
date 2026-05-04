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
 * Subset of the wizard's reactive `formData` that this helper reads/writes.
 * Wider shapes (with extra wizard-only fields) are accepted via spread.
 *
 * @typedef {Object} EnrichableFormData
 * @property {string} [name]
 * @property {string} [description]
 * @property {string} [image]
 * @property {string} [inLanguage]
 * @property {string} [license]
 * @property {Array<{id: string, label: string}>} [learningResourceType]
 * @property {Array<{id: string, label: string}>} [educationalLevels]
 * @property {string[]} [keywords]
 * @property {Array<Record<string, unknown>>} [creators]
 */

/**
 * @param {Array<{id: string, prefLabel?: string}>} arr
 * @returns {Array<{id: string, label: string}>}
 */
function toFormConcepts(arr) {
  return arr.map((c) => ({ id: c.id, label: c.prefLabel ?? '' }));
}

/**
 * @typedef {{ source: 'llm-enriched', evidence?: string }} FieldProvenance
 * @typedef {Record<string, FieldProvenance>} ProvenanceMap
 */

/**
 * Apply enriched payload AND build a per-field provenance map. The map
 * records only fields the helper actually filled (skipped fields stay
 * absent), so the wizard's badge layer can iterate it directly.
 *
 * `options.activeUserPubkey` lets the helper detect the wizard's auto-added
 * "you are the author" creator entry and replace it when the LLM finds real
 * authors on a 3rd-party URL.
 *
 * @template {EnrichableFormData} T
 * @param {T} formData
 * @param {ExtractMetadataResult | null | undefined} result
 * @param {{ activeUserPubkey?: string }} [options]
 * @returns {{ formData: T, provenance: ProvenanceMap }}
 */
function applyEnrichedPayloadWithProvenance(formData, result, options = {}) {
  /** @type {EnrichableFormData & Record<string, any>} */
  const next = { ...formData };
  /** @type {ProvenanceMap} */
  const provenance = {};
  if (!result || result.source === 'amb-jsonld') {
    return { formData: /** @type {T} */ (next), provenance };
  }
  const payload = /** @type {Record<string, any>} */ (result.payload ?? {});
  const evidence = /** @type {Record<string, string>} */ (result.evidence ?? {});

  /** @param {string} field */
  const mark = (field) => {
    const quote = evidence[field];
    provenance[field] =
      typeof quote === 'string' && quote.length > 0
        ? { source: 'llm-enriched', evidence: quote }
        : { source: 'llm-enriched' };
  };

  if (typeof payload.name === 'string' && !next.name) {
    next.name = payload.name;
    mark('name');
  }
  if (typeof payload.description === 'string' && !next.description) {
    next.description = payload.description;
    mark('description');
  }
  if (typeof payload.image === 'string' && !next.image) {
    next.image = payload.image;
    mark('image');
  }
  if (
    typeof payload.inLanguage === 'string' &&
    (!next.inLanguage || next.inLanguage === FORM_DEFAULT_LANGUAGE)
  ) {
    next.inLanguage = payload.inLanguage;
    mark('inLanguage');
  }

  if (Array.isArray(payload.learningResourceType) && next.learningResourceType?.length === 0) {
    next.learningResourceType = toFormConcepts(payload.learningResourceType);
    mark('learningResourceType');
  }
  if (Array.isArray(payload.educationalLevels) && next.educationalLevels?.length === 0) {
    next.educationalLevels = toFormConcepts(payload.educationalLevels);
    mark('educationalLevels');
  }

  if (Array.isArray(payload.keywords) && next.keywords?.length === 0) {
    next.keywords = [...payload.keywords];
    mark('keywords');
  }

  // Treat a single entry that's just the active user as "empty for enrichment
  // purposes" — the wizard auto-adds the logged-in user as creator on login,
  // but for a 3rd-party URL the LLM-extracted authors are the right answer.
  const creators = next.creators ?? [];
  const isAutoAddedActiveUser =
    options.activeUserPubkey != null &&
    creators.length === 1 &&
    /** @type {{pubkey?: string}} */ (creators[0]).pubkey === options.activeUserPubkey;
  if (
    Array.isArray(payload.creators) &&
    payload.creators.length > 0 &&
    (creators.length === 0 || isAutoAddedActiveUser)
  ) {
    next.creators = payload.creators.map((c) => ({ ...c }));
    mark('creators');
  }

  if (typeof payload.license === 'string' && next.license === FORM_DEFAULT_LICENSE) {
    next.license = payload.license;
    mark('license');
  }

  // EKW-only fields. ekwFachrichtung uses a single {id,label}[] shape; the
  // paired SKOS arrays (gradeLevels/schoolTypes/didacticConcepts/methods)
  // store IDs in `<key>` and the full records in `<key>Labels` because the
  // wizard's EKW UI binds them as a pair (see ResourceFormWizard step 4).
  if (Array.isArray(payload.ekwFachrichtung) && next.ekwFachrichtung?.length === 0) {
    next.ekwFachrichtung = toFormConcepts(payload.ekwFachrichtung);
    mark('ekwFachrichtung');
  }
  // Wizard naming: IDs key is plural (gradeLevels), labels key drops the
  // trailing 's' (gradeLevelLabels). Map explicitly — `${key}Labels` would
  // produce the wrong key (gradeLevelsLabels) and the wizard would read [].
  /** @type {Array<[string, string]>} */
  const pairedKeys = [
    ['gradeLevels', 'gradeLevelLabels'],
    ['schoolTypes', 'schoolTypeLabels'],
    ['didacticConcepts', 'didacticConceptLabels'],
    ['methods', 'methodLabels']
  ];
  for (const [key, labelsKey] of pairedKeys) {
    if (Array.isArray(payload[key]) && next[key]?.length === 0) {
      const concepts = toFormConcepts(payload[key]);
      next[key] = concepts.map((c) => c.id);
      next[labelsKey] = concepts;
      mark(key); // provenance keyed on user-facing field, not labels mirror
    }
  }

  if (typeof payload.methodOther === 'string' && !next.methodOther) {
    next.methodOther = payload.methodOther;
    mark('methodOther');
  }

  // bibleReferences default in the wizard is `['']` — treat that as empty.
  const refsAreEmpty =
    !next.bibleReferences ||
    next.bibleReferences.length === 0 ||
    (next.bibleReferences.length === 1 && next.bibleReferences[0] === '');
  if (Array.isArray(payload.bibleReferences) && refsAreEmpty) {
    next.bibleReferences = [...payload.bibleReferences];
    mark('bibleReferences');
  }

  return { formData: /** @type {T} */ (next), provenance };
}

/**
 * @template {EnrichableFormData} T
 * @param {T} formData - the wizard's reactive formData object
 * @param {ExtractMetadataResult | null | undefined} result
 * @param {{ activeUserPubkey?: string }} [options]
 * @returns {T} a new formData object with enriched values applied
 */
export function applyEnrichedPayload(formData, result, options) {
  return applyEnrichedPayloadWithProvenance(formData, result, options).formData;
}

/**
 * Same as {@link applyEnrichedPayload} but also returns a per-field
 * provenance map ({source, evidence?}) for the fields that were filled.
 * The wizard uses this to render Smart-fill badges with hover-evidence.
 */
applyEnrichedPayload.withProvenance = applyEnrichedPayloadWithProvenance;
