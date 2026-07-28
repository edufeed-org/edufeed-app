// src/lib/helpers/educational/konfiTags.js
import { EKW_KONFI_NS } from './ekwNamespace.js';

const KONFI_PREFIX = `ext:${EKW_KONFI_NS}:`;

/**
 * @typedef {{ id: string, labels?: Record<string, string> }} KonfiSelectedConcept
 */

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
 * Reads Konfi facet tags (`ext:org.edufeed.ekw.konfi:<tagSlug>[:sub]`, emitted
 * by `ambToNostr` from `amb.ext[EKW_KONFI_NS]` — see `formDataToAmbExt.js`)
 * from an existing kind-30142 event. Walks the same sub-step config the
 * emit side (`formDataToAmbExt.buildKonfiFacets`) walks, and produces a
 * partial form-data object with `<schemeKey>Ids` / `<schemeKey>Labels` for
 * vocab fields and `<tagSlug>` for scalar fields.
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
          // ambToNostr serializes a facet's mixed Concept[]/string[] items in
          // order: each Concept as an `:id`/`:prefLabel:*`/`:type` run, each
          // plain string as a BARE `ext:<ns>:<facet>` tag (see
          // formDataToAmbExt.buildKonfiFacets + ambToNostr's ext-emission
          // loop) — there is no `:custom` sub-key on the wire. A bare tag can
          // only occur here for the custom string (concepts always carry
          // `:id`), so reading the bare key recovers it unambiguously.
          const customKey = `${KONFI_PREFIX}${field.tagSlug}`;
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
