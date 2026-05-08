import { FORM_DEFAULT_LICENSE, FORM_DEFAULT_LANGUAGE } from './formDefaults.js';

export const ENRICHABLE_FIELDS = Object.freeze([
  'name',
  'description',
  'image',
  'inLanguage',
  'license',
  'methodOther',
  'learningResourceType',
  'educationalLevels',
  'keywords',
  'creators',
  'gradeLevels',
  'schoolTypes',
  'didacticConcepts',
  'methods',
  'bibleReferences',
  'ekwFachrichtung'
]);

export const STRING_FIELDS = new Set([
  'name',
  'description',
  'image',
  'inLanguage',
  'license',
  'methodOther'
]);

const PLAIN_STRING_FIELDS = new Set(['name', 'description', 'image', 'methodOther']);

const CONCEPT_ARRAY_FIELDS = new Set([
  'learningResourceType',
  'educationalLevels',
  'creators',
  'gradeLevels',
  'schoolTypes',
  'didacticConcepts',
  'methods'
]);
const STRING_ARRAY_FIELDS = new Set(['keywords', 'bibleReferences']);
const ABOUT_BY_VOCAB_FIELDS = new Set(['ekwFachrichtung']);

/**
 * Paired-key fields store IDs in `${field}` and labels in `${field}Labels`.
 * FormConceptPicker's label-heal $effect rewrites incoming IDs to canonical
 * nostr-coords once Concept events load — but `aiSuggestions.payload` keeps
 * the AI's original IDs. The two ID spaces diverge while labels stay equal,
 * so we compare by label here instead of by ID.
 */
/** @type {Record<string, string>} */
const PAIRED_KEY_LABEL_MIRRORS = Object.freeze({
  gradeLevels: 'gradeLevelLabels',
  schoolTypes: 'schoolTypeLabels',
  didacticConcepts: 'didacticConceptLabels',
  methods: 'methodLabels'
});

/** @param {unknown} arr */
function conceptIds(arr) {
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr.map((c) => (typeof c === 'string' ? c : c?.id)).filter(Boolean));
}

/** @param {unknown} arr */
function isBibleEmpty(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return true;
  return arr.length === 1 && arr[0] === '';
}

/**
 * @param {string} field
 * @param {unknown} userArr
 * @param {unknown} aiArr
 */
function classifyArray(field, userArr, aiArr) {
  const aiIds = conceptIds(aiArr);
  const userIds =
    field === 'bibleReferences'
      ? new Set(isBibleEmpty(userArr) ? [] : /** @type {any[]} */ (userArr))
      : conceptIds(userArr);

  if (aiIds.size === 0) return 'none';
  if (userIds.size === 0) return 'auto-applied';

  const aiSubset = [...aiIds].every((id) => userIds.has(id));
  const userSubset = [...userIds].every((id) => aiIds.has(id));
  if (aiSubset && userSubset) return 'none'; // sets equal
  if (userSubset) return 'additive'; // AI strict superset
  return 'conflict'; // any other partial/disjoint
}

/**
 * Label-based classification for paired-key fields (gradeLevels, etc.).
 * Reads user labels from the `${field}Labels` mirror in formData and AI labels
 * from `prefLabel` (fallback `label`) on each entry. Same set-comparison logic
 * as classifyArray but on labels — robust to ID-space rewrites by FormConceptPicker.
 */
/**
 * @param {Record<string, any>} formData
 * @param {string} field
 * @param {unknown} aiArr
 */
function classifyPairedByLabel(formData, field, aiArr) {
  const labelsKey = PAIRED_KEY_LABEL_MIRRORS[field];
  const userArr = Array.isArray(formData?.[labelsKey]) ? formData[labelsKey] : [];
  const userLabels = new Set(
    userArr
      .map((/** @type {any} */ c) => (c && typeof c === 'object' ? c.label : undefined))
      .filter(Boolean)
  );
  const aiLabels = new Set(
    (Array.isArray(aiArr) ? aiArr : [])
      .map((c) => (c && typeof c === 'object' ? c.prefLabel || c.label : undefined))
      .filter(Boolean)
  );

  if (aiLabels.size === 0) return 'none';
  if (userLabels.size === 0) return 'auto-applied';

  const aiSubset = [...aiLabels].every((l) => userLabels.has(l));
  const userSubset = [...userLabels].every((l) => aiLabels.has(l));
  if (aiSubset && userSubset) return 'none';
  if (userSubset) return 'additive';
  return 'conflict';
}

/**
 * Treat a string field's value as empty if it's '' or matches the form default.
 * `inLanguage` and `license` are routed in via name because they have
 * non-empty defaults that count as "empty" for conflict purposes.
 * @param {string} field
 * @param {unknown} value
 */
function isStringEmpty(field, value) {
  if (!value) return true;
  if (field === 'inLanguage' && value === FORM_DEFAULT_LANGUAGE) return true;
  if (field === 'license' && value === FORM_DEFAULT_LICENSE) return true;
  return false;
}

/**
 * Classify the AI-vs-user state for one field.
 * @param {string} field
 * @param {Record<string, any>} formData
 * @param {Record<string, Array<{id: string, label?: string}>>} aboutByVocab
 * @param {{payload?: Record<string, any>} | null | undefined} aiSuggestions
 * @returns {'none' | 'auto-applied' | 'conflict' | 'additive'}
 */
export function getFieldConflict(field, formData, aboutByVocab, aiSuggestions) {
  if (!aiSuggestions) return 'none';
  const aiValue = aiSuggestions.payload?.[field];
  if (aiValue == null) return 'none';

  if (PLAIN_STRING_FIELDS.has(field) || field === 'inLanguage' || field === 'license') {
    const userValue = formData[field];
    if (isStringEmpty(field, userValue)) return 'auto-applied';
    if (userValue === aiValue) return 'none';
    return 'conflict';
  }

  if (ABOUT_BY_VOCAB_FIELDS.has(field)) {
    return classifyArray(field, aboutByVocab?.[field], aiValue);
  }

  if (PAIRED_KEY_LABEL_MIRRORS[field]) {
    return classifyPairedByLabel(formData, field, aiValue);
  }

  if (CONCEPT_ARRAY_FIELDS.has(field) || STRING_ARRAY_FIELDS.has(field)) {
    return classifyArray(field, formData[field], aiValue);
  }

  return 'none';
}
