// src/lib/helpers/educational/parseKonfiTagsToFormData.js
import { parseKonfiTags } from './konfiTags.js';

/**
 * Reads Konfi-specific tags from an existing kind-30142 event and returns a
 * partial form-data fragment with `<schemeKey>Ids` / `<schemeKey>Labels` for
 * vocab fields and `<tagSlug>` for scalar fields.
 *
 * @param {{ tags: string[][] }} event
 * @param {import('./konfiTags.js').SubStepConfig[]} subSteps
 * @returns {Record<string, any>}
 */
export function parseKonfiTagsToFormData(event, subSteps) {
  return parseKonfiTags(event?.tags || [], subSteps);
}
