import { EKW_TAG_PREFIX } from './ekwNamespace.js';

/**
 * @typedef {{ id: string, label: string }} ConceptLabel
 */

/**
 * Build EKW-specific kind-30142 tags from wizard formData.
 *
 * For vocab-bound multi-select fields (gradeLevel, schoolType, didacticConcept,
 * method) emits a triple per concept:
 *   [`${EKW_TAG_PREFIX}<facet>:id`, <uri>]
 *   [`${EKW_TAG_PREFIX}<facet>:prefLabel:de`, <label>]
 *   [`${EKW_TAG_PREFIX}<facet>:type`, 'Concept']
 *
 * For free-form fields emits one tag per non-empty entry:
 *   [`${EKW_TAG_PREFIX}methodOther`, <line>]
 *   [`${EKW_TAG_PREFIX}bibleReference`, <entry>]
 *
 * Mirrors the `amb:<facet>:id` / `amb:<facet>:prefLabel:<lang>` convention used
 * by `amb-nostr-converter`. Returns `[]` when no EKW data is present, so it is
 * safe to always call.
 *
 * @param {{
 *   gradeLevels?: string[],
 *   gradeLevelLabels?: ConceptLabel[],
 *   schoolTypes?: string[],
 *   schoolTypeLabels?: ConceptLabel[],
 *   didacticConcepts?: string[],
 *   didacticConceptLabels?: ConceptLabel[],
 *   methods?: string[],
 *   methodLabels?: ConceptLabel[],
 *   methodOther?: string,
 *   bibleReferences?: string[]
 * }} formData
 * @returns {string[][]}
 */
export function formDataToEkwTags(formData) {
  /** @type {string[][]} */
  const tags = [];

  /**
   * @param {string} facet
   * @param {string[] | undefined} ids
   * @param {ConceptLabel[] | undefined} labels
   */
  function emitConceptTriple(facet, ids, labels) {
    if (!ids || ids.length === 0) return;
    const labelById = new Map((labels || []).map((l) => [l.id, l.label]));
    for (const id of ids) {
      tags.push([`${EKW_TAG_PREFIX}${facet}:id`, id]);
      const label = labelById.get(id);
      if (label) tags.push([`${EKW_TAG_PREFIX}${facet}:prefLabel:de`, label]);
      tags.push([`${EKW_TAG_PREFIX}${facet}:type`, 'Concept']);
    }
  }

  emitConceptTriple('gradeLevel', formData.gradeLevels, formData.gradeLevelLabels);
  emitConceptTriple('schoolType', formData.schoolTypes, formData.schoolTypeLabels);
  emitConceptTriple('didacticConcept', formData.didacticConcepts, formData.didacticConceptLabels);
  emitConceptTriple('method', formData.methods, formData.methodLabels);

  const otherLines = (formData.methodOther || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const line of otherLines) {
    tags.push([`${EKW_TAG_PREFIX}methodOther`, line]);
  }

  const refs = (formData.bibleReferences || []).map((s) => s.trim()).filter(Boolean);
  for (const r of refs) {
    tags.push([`${EKW_TAG_PREFIX}bibleReference`, r]);
  }

  return tags;
}
