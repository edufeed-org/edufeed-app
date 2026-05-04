import { EKW_TAG_PREFIX } from './ekwNamespace.js';

/**
 * Inverse of `formDataToEkwTags`. Reads an existing kind-30142 event and
 * extracts the EKW form-state fragment so wizard edit-mode can prefill.
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
    const idKey = `${EKW_TAG_PREFIX}${facet}:id`;
    const labelKey = `${EKW_TAG_PREFIX}${facet}:prefLabel:de`;
    const ids = tags.filter((t) => t[0] === idKey).map((t) => t[1]);
    const labels = tags.filter((t) => t[0] === labelKey).map((t) => t[1]);
    /** @type {{id: string, label: string}[]} */
    const pairs = ids.map((id, i) => ({ id, label: labels[i] ?? id }));
    return { ids, labels: pairs };
  }

  const grade = collectFacet('gradeLevel');
  const school = collectFacet('schoolType');
  const didactic = collectFacet('didacticConcept');
  const method = collectFacet('method');

  const methodOther = tags
    .filter((t) => t[0] === `${EKW_TAG_PREFIX}methodOther`)
    .map((t) => t[1])
    .join('\n');

  const bibleReferences = tags
    .filter((t) => t[0] === `${EKW_TAG_PREFIX}bibleReference`)
    .map((t) => t[1]);

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
