/**
 * Educator profile helpers: the kind-0 `edufeed` object (interests,
 * educationalLevels, subjects) and the Bildungsbereich ↔ profile concept
 * mapping.
 *
 * Profile educationalLevels use edufeed-namespace Bildungsbereich concepts
 * (`https://edufeed.org/ns/bildungsbereich#schule`) rather than KIM
 * educationalLevel URIs, because one Bildungsbereich maps to several flat KIM
 * concepts. The KIM mapping stays available via
 * `BILDUNGSBEREICHE[key].educationalLevelMapping` for future resource matching.
 */

import { BILDUNGSBEREICHE, BILDUNGSBEREICH_KEYS } from './bildungsbereich.js';
import { BILDUNGSBEREICH_NAMESPACE_IRI } from './bildungsbereichNamespace.js';

/**
 * @typedef {Object} ProfileConcept
 * @property {string} id
 * @property {Record<string, string>} [prefLabel]
 */

/**
 * @typedef {Object} EdufeedProfile
 * @property {string[]} interests
 * @property {ProfileConcept[]} educationalLevels
 * @property {SubjectConcept[]} subjects
 */

/**
 * SKOS-shaped concepts for every Bildungsbereich, for use as the profile
 * educational-level options.
 *
 * @returns {ProfileConcept[]}
 */
export function getBildungsbereichProfileConcepts() {
  return BILDUNGSBEREICH_KEYS.map((key) => ({
    id: `${BILDUNGSBEREICH_NAMESPACE_IRI}${key}`,
    prefLabel: { ...BILDUNGSBEREICHE[key].label }
  }));
}

/**
 * Extract the Bildungsbereich key from a profile concept id.
 *
 * @param {string | undefined} conceptId
 * @returns {import('./bildungsbereich.js').BildungsbereichKey | undefined}
 */
export function bildungsbereichKeyFromConceptId(conceptId) {
  if (typeof conceptId !== 'string' || !conceptId.startsWith(BILDUNGSBEREICH_NAMESPACE_IRI)) {
    return undefined;
  }
  const key = conceptId.slice(BILDUNGSBEREICH_NAMESPACE_IRI.length);
  return BILDUNGSBEREICH_KEYS.includes(/** @type {any} */ (key))
    ? /** @type {import('./bildungsbereich.js').BildungsbereichKey} */ (key)
    : undefined;
}

/**
 * Union of subject vocab keys for the selected Bildungsbereich concepts,
 * deduped, in selection order. Unknown concepts are ignored.
 *
 * @param {ProfileConcept[]} concepts
 * @returns {string[]}
 */
export function getSubjectVocabKeysForConcepts(concepts) {
  /** @type {string[]} */
  const out = [];
  for (const concept of concepts) {
    const key = bildungsbereichKeyFromConceptId(concept?.id);
    if (!key) continue;
    for (const vocabKey of BILDUNGSBEREICHE[key].subjectVocabKeys) {
      if (!out.includes(vocabKey)) out.push(vocabKey);
    }
  }
  return out;
}

/**
 * @typedef {ProfileConcept & { vocab?: string }} SubjectConcept
 */

/**
 * @typedef {Object} PickerConcept - `FormConceptPicker`'s rich SelectedConcept shape
 * @property {string} id
 * @property {string} nostrCoord
 * @property {string} relay
 * @property {Record<string, string>} labels
 */

/**
 * Display label for a profile concept: requested locale → de → en → any.
 *
 * @param {Record<string, string> | undefined} prefLabel
 * @param {string} locale
 * @returns {string}
 */
export function pickConceptLabel(prefLabel, locale) {
  if (!prefLabel) return '';
  return prefLabel[locale] || prefLabel.de || prefLabel.en || Object.values(prefLabel)[0] || '';
}

/**
 * Profile subjects of one vocab, converted to `FormConceptPicker` values.
 * `nostrCoord`/`relay` are unknown at profile level; the picker re-hydrates
 * them from loaded concept events when needed.
 *
 * @param {SubjectConcept[]} subjects
 * @param {string} vocabKey
 * @returns {PickerConcept[]}
 */
export function subjectsToPickerValue(subjects, vocabKey) {
  return subjects
    .filter((s) => s.vocab === vocabKey)
    .map((s) => ({ id: s.id, nostrCoord: '', relay: '', labels: { ...(s.prefLabel ?? {}) } }));
}

/**
 * Merge one vocab picker's selection back into the full subjects array:
 * subjects of other vocabs (and untagged/foreign ones) are kept, the given
 * vocab's slice is replaced by the picked concepts.
 *
 * @param {SubjectConcept[]} subjects
 * @param {string} vocabKey
 * @param {PickerConcept[]} picked
 * @returns {SubjectConcept[]}
 */
export function mergeSubjectsForVocab(subjects, vocabKey, picked) {
  return [
    ...subjects.filter((s) => s.vocab !== vocabKey),
    ...picked.map((p) => ({ id: p.id, prefLabel: { ...p.labels }, vocab: vocabKey }))
  ];
}

/**
 * @param {unknown} value
 * @returns {ProfileConcept[]}
 */
function sanitizeConcepts(value) {
  if (!Array.isArray(value)) return [];
  return /** @type {ProfileConcept[]} */ (
    value.filter(
      (c) => typeof c === 'object' && c !== null && typeof (/** @type {any} */ (c).id) === 'string'
    )
  );
}

/**
 * Defensive reader for the kind-0 `edufeed` object. Tolerates missing or
 * malformed content and always returns arrays.
 *
 * @param {Record<string, unknown> | null | undefined} profileContent - parsed kind-0 content
 * @returns {EdufeedProfile}
 */
export function parseEdufeedProfile(profileContent) {
  const edufeed = profileContent?.edufeed;
  if (typeof edufeed !== 'object' || edufeed === null || Array.isArray(edufeed)) {
    return { interests: [], educationalLevels: [], subjects: [] };
  }
  const { interests, educationalLevels, subjects } = /** @type {Record<string, unknown>} */ (
    edufeed
  );
  return {
    interests: Array.isArray(interests)
      ? interests.filter((i) => typeof i === 'string' && i.length > 0)
      : [],
    educationalLevels: sanitizeConcepts(educationalLevels),
    subjects: sanitizeConcepts(subjects)
  };
}

/**
 * Extracts interest values from a NIP-51 kind 10015 interests list event:
 * `t` tags, trimmed, empties dropped, deduped case-insensitively keeping the
 * first spelling. Ignores other tags (`a` interest-set refs, `alt`, ...).
 *
 * @param {import('nostr-tools').NostrEvent | null | undefined} event
 * @returns {string[]}
 */
export function interestsFromListEvent(event) {
  if (!Array.isArray(event?.tags)) return [];
  /** @type {string[]} */
  const interests = [];
  const seen = new Set();
  for (const tag of event.tags) {
    if (tag?.[0] !== 't' || typeof tag[1] !== 'string') continue;
    const value = tag[1].trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    interests.push(value);
  }
  return interests;
}

/**
 * Resolves a user's interests: the kind 10015 list is authoritative when it
 * exists (even when empty), otherwise falls back to the legacy kind-0
 * `edufeed.interests` array.
 *
 * @param {import('nostr-tools').NostrEvent | null | undefined} listEvent
 * @param {Record<string, unknown> | null | undefined} profileContent - parsed kind-0 content
 * @returns {string[]}
 */
export function resolveProfileInterests(listEvent, profileContent) {
  if (listEvent) return interestsFromListEvent(listEvent);
  return parseEdufeedProfile(profileContent).interests;
}
