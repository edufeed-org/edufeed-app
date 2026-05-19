// src/lib/helpers/educational/konfiTags.js
import { EKW_TAG_PREFIX } from './ekwNamespace.js';

const KONFI_PREFIX = `${EKW_TAG_PREFIX}konfi:`;

/**
 * @typedef {{ id: string, labels?: Record<string, string> }} KonfiSelectedConcept
 */

/**
 * Emit the canonical id/prefLabel:de/type triple per selected concept.
 *
 * @param {string} tagSlug - short facet name, e.g. 'zielgruppen', 'themen'
 * @param {KonfiSelectedConcept[] | undefined} concepts
 * @returns {string[][]}
 */
export function emitKonfiVocabTags(tagSlug, concepts) {
  if (!concepts || concepts.length === 0) return [];
  /** @type {string[][]} */
  const tags = [];
  for (const c of concepts) {
    tags.push([`${KONFI_PREFIX}${tagSlug}:id`, c.id]);
    const de = c.labels?.de;
    if (de) tags.push([`${KONFI_PREFIX}${tagSlug}:prefLabel:de`, de]);
    tags.push([`${KONFI_PREFIX}${tagSlug}:type`, 'Concept']);
  }
  return tags;
}

/**
 * Emit a single scalar tag. `false`, empty, whitespace-only, null, and
 * undefined values produce no tags. `true` is serialized as the string
 * `"true"` so the parse path can round-trip it.
 *
 * @param {string} tagSlug
 * @param {string | boolean | undefined | null} value
 * @returns {string[][]}
 */
export function emitKonfiScalarTags(tagSlug, value) {
  if (value === undefined || value === null || value === false) return [];
  const str = typeof value === 'boolean' ? 'true' : String(value);
  if (str.trim() === '') return [];
  return [[`${KONFI_PREFIX}${tagSlug}`, str]];
}

/**
 * Re-export the canonical sub-step type definitions from `bildungsbereich.js`
 * so consumers of this module (e.g. `konfiStep4.js`) see the same shape as the
 * wizard. Keeping a divergent local copy here previously caused svelte-check
 * to lose the `labelKey` property and reject test fixtures.
 *
 * @typedef {import('./bildungsbereich.js').SubStepFieldVocab} SubStepFieldVocab
 * @typedef {import('./bildungsbereich.js').SubStepFieldScalar} SubStepFieldScalar
 * @typedef {SubStepFieldVocab | SubStepFieldScalar} SubStepField
 * @typedef {import('./bildungsbereich.js').SubStepConfig} SubStepConfig
 */

/**
 * Inverse of `emitKonfiVocabTags` + `emitKonfiScalarTags`. Walks the same
 * sub-step config used at emit time and produces a partial form-data object
 * with `<schemeKey>Ids` / `<schemeKey>Labels` for vocab fields and `<tagSlug>`
 * for scalar fields.
 *
 * @param {string[][]} tags
 * @param {SubStepConfig[]} subSteps
 * @returns {Record<string, any>}
 */
export function parseKonfiTags(tags, subSteps) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const step of subSteps) {
    for (const field of step.fields) {
      if (field.kind === 'vocab') {
        const idKey = `${KONFI_PREFIX}${field.tagSlug}:id`;
        const labelKey = `${KONFI_PREFIX}${field.tagSlug}:prefLabel:de`;
        const ids = tags.filter((t) => t[0] === idKey).map((t) => t[1]);
        if (ids.length > 0) {
          const labelValues = tags.filter((t) => t[0] === labelKey).map((t) => t[1]);
          out[`${field.schemeKey}Ids`] = ids;
          out[`${field.schemeKey}Labels`] = ids.map((id, i) => ({
            id,
            label: labelValues[i] ?? id
          }));
        }
        if (field.allowCustom) {
          const customKey = `${KONFI_PREFIX}${field.tagSlug}:custom`;
          const customTag = tags.find((t) => t[0] === customKey);
          if (customTag && typeof customTag[1] === 'string' && customTag[1].trim() !== '') {
            out[`${field.schemeKey}Custom`] = customTag[1];
          }
        }
      } else {
        const t = tags.find((tag) => tag[0] === `${KONFI_PREFIX}${field.tagSlug}`);
        if (!t) continue;
        if (field.input === 'checkbox') {
          out[field.tagSlug] = t[1] === 'true';
        } else {
          out[field.tagSlug] = t[1];
        }
      }
    }
  }
  return out;
}
