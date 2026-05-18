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
