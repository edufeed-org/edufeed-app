import { EKW_TAG_PREFIX, EKW_LEGACY_TAG_PREFIX } from './ekwNamespace.js';

/**
 * Inverse of the EKW facets `formDataToAmbExt.js` builds (emitted on the wire
 * by `ambToNostr` from `amb.ext.ekw`). Reads an existing kind-30142 event and
 * extracts the EKW form-state fragment so wizard edit-mode can prefill.
 *
 * Reads both the canonical `ext:ekw:*` shape (new) and the legacy unprefixed
 * `ekw:*` shape (pre-migration). When both are present the new shape wins;
 * the legacy fallback only kicks in for facets that have no `ext:ekw:*` tags.
 *
 * @param {{ tags: string[][] }} event
 * @returns {{
 *   gradeLevels: string[],
 *   gradeLevelLabels: { id: string, label: string }[],
 *   schoolTypes: string[],
 *   schoolTypeLabels: { id: string, label: string }[],
 *   didacticConcepts: string[],
 *   didacticConceptLabels: { id: string, label: string }[],
 *   methods: string[],
 *   methodLabels: { id: string, label: string }[],
 *   methodOther: string,
 *   bibleReferences: string[]
 * }}
 */
export function parseEkwTagsToFormData(event) {
  const tags = event?.tags || [];

  function collectFacet(/** @type {string} */ facet) {
    const newPair = collectFacetWithPrefix(tags, EKW_TAG_PREFIX, facet);
    if (newPair.ids.length > 0) return newPair;
    return collectFacetWithPrefix(tags, EKW_LEGACY_TAG_PREFIX, facet);
  }

  function collectScalar(/** @type {string} */ facet) {
    const newKey = `${EKW_TAG_PREFIX}${facet}`;
    const legacyKey = `${EKW_LEGACY_TAG_PREFIX}${facet}`;
    const newValues = tags.filter((t) => t[0] === newKey).map((t) => t[1]);
    if (newValues.length > 0) return newValues;
    return tags.filter((t) => t[0] === legacyKey).map((t) => t[1]);
  }

  const grade = collectFacet('gradeLevel');
  const school = collectFacet('schoolType');
  const didactic = collectFacet('didacticConcept');
  const method = collectFacet('method');

  const methodOther = collectScalar('methodOther').join('\n');
  const bibleReferences = collectScalar('bibleReference');

  return {
    gradeLevels: grade.ids,
    gradeLevelLabels: grade.labels,
    schoolTypes: school.ids,
    schoolTypeLabels: school.labels,
    didacticConcepts: didactic.ids,
    didacticConceptLabels: didactic.labels,
    methods: method.ids,
    methodLabels: method.labels,
    methodOther,
    bibleReferences
  };
}

/**
 * @param {string[][]} tags
 * @param {string} prefix - either `ext:ekw:` or legacy `ekw:`
 * @param {string} facet
 */
function collectFacetWithPrefix(tags, prefix, facet) {
  const idKey = `${prefix}${facet}:id`;
  const labelKey = `${prefix}${facet}:prefLabel:de`;
  const ids = tags.filter((t) => t[0] === idKey).map((t) => t[1]);
  const labels = tags.filter((t) => t[0] === labelKey).map((t) => t[1]);
  /** @type {{id: string, label: string}[]} */
  const pairs = ids.map((id, i) => ({ id, label: labels[i] ?? id }));
  return { ids, labels: pairs };
}
