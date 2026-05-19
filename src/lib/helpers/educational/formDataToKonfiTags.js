// src/lib/helpers/educational/formDataToKonfiTags.js
import { emitKonfiVocabTags, emitKonfiScalarTags } from './konfiTags.js';
import { bildungsbereichToNip32Tags } from './bildungsbereichNamespace.js';

/**
 * Build Konfi-specific kind-30142 tags from wizard formData, walking the
 * configured `step4SubSteps`. Appends the Bildungsbereich NIP-32 detection
 * tag pair when `bildungsbereichTag` is provided.
 *
 * Returns `[]` when both `bildungsbereichTag` is missing and no Konfi data
 * is present — safe to always call.
 *
 * @param {Record<string, any>} formData
 * @param {import('./konfiTags.js').SubStepConfig[]} subSteps
 * @param {string | undefined} bildungsbereichTag
 * @returns {string[][]}
 */
export function formDataToKonfiTags(formData, subSteps, bildungsbereichTag) {
  /** @type {string[][]} */
  const tags = [];
  for (const step of subSteps) {
    for (const field of step.fields) {
      if (field.kind === 'vocab') {
        const ids = formData[`${field.schemeKey}Ids`] || [];
        const labels = formData[`${field.schemeKey}Labels`] || [];
        const labelById = new Map(
          labels.map((/** @type {{id:string,label:string}} */ l) => [l.id, l.label])
        );
        const concepts = ids.map((/** @type string */ id) => ({
          id,
          labels: labelById.has(id) ? { de: labelById.get(id) } : {}
        }));
        tags.push(...emitKonfiVocabTags(field.tagSlug, concepts));
      } else {
        tags.push(...emitKonfiScalarTags(field.tagSlug, formData[field.tagSlug]));
      }
    }
  }
  if (bildungsbereichTag) tags.push(...bildungsbereichToNip32Tags(bildungsbereichTag));
  return tags;
}
