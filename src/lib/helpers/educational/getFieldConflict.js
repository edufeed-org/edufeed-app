const FORM_DEFAULT_LICENSE = 'https://creativecommons.org/licenses/by/4.0/';
const FORM_DEFAULT_LANGUAGE = 'de';

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

const STRING_FIELDS = new Set(['name', 'description', 'image', 'methodOther']);

/** Treat a string field's value as empty if it's '' or matches the form default. */
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
 * @param {{payload: Record<string, any>} | null} aiSuggestions
 * @returns {'none' | 'auto-applied' | 'conflict' | 'additive'}
 */
export function getFieldConflict(field, formData, aboutByVocab, aiSuggestions) {
  if (!aiSuggestions) return 'none';
  const aiValue = aiSuggestions.payload?.[field];
  if (aiValue == null) return 'none';

  if (STRING_FIELDS.has(field) || field === 'inLanguage' || field === 'license') {
    const userValue = formData[field];
    if (isStringEmpty(field, userValue)) return 'auto-applied';
    if (userValue === aiValue) return 'none';
    return 'conflict';
  }

  // Array & aboutByVocab fields handled in later tasks.
  return 'none';
}
