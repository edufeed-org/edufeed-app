/**
 * Pure render helper for the AI suggestion review surface (badge + future
 * dialog readers). Mirrors the rendering rules the original dialog used,
 * with one bug fix for the paired-key concept fields (gradeLevels etc.)
 * whose labels live in a sibling key, not on the value array itself.
 *
 * - Plain string fields: returned verbatim.
 * - Concept arrays ([{id, label}]): joined by label, fallback to id.
 * - Paired-key concept fields: read labels from `${field}Labels` mirror when present and non-empty; fall back to raw IDs array if the labels mirror is missing or empty.
 * - ekwFachrichtung: read from aboutByVocab (lives outside formData).
 * - String arrays (keywords, bibleReferences): joined by comma.
 */

const PAIRED_LABEL_KEYS = {
  gradeLevels: 'gradeLevelLabels',
  schoolTypes: 'schoolTypeLabels',
  didacticConcepts: 'didacticConceptLabels',
  methods: 'methodLabels'
};

/**
 * @param {string} field
 * @param {Record<string, any>} formData
 * @param {Record<string, Array<{id: string, label?: string}>>} aboutByVocab
 * @returns {string}
 */
export function formatFieldValue(field, formData, aboutByVocab) {
  if (field === 'ekwFachrichtung') {
    return (aboutByVocab?.ekwFachrichtung ?? []).map((c) => c.label || c.id).join(', ');
  }
  const labelsKey = PAIRED_LABEL_KEYS[field];
  if (labelsKey && Array.isArray(formData?.[labelsKey]) && formData[labelsKey].length > 0) {
    return formData[labelsKey].map((c) => c.label || c.id).join(', ');
  }
  const v = formData?.[field];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : x?.label || x?.id || ''))
      .filter(Boolean)
      .join(', ');
  }
  return v != null ? String(v) : '';
}

/**
 * @param {string} field
 * @param {{ payload?: Record<string, any> } | null | undefined} aiSuggestions
 * @returns {string}
 */
export function formatAiFieldValue(field, aiSuggestions) {
  const v = aiSuggestions?.payload?.[field];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x : x?.prefLabel || x?.label || x?.id || ''))
      .filter(Boolean)
      .join(', ');
  }
  return v != null ? String(v) : '';
}
