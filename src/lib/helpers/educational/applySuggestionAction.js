const CONCEPT_ARRAY_FIELDS = new Set(['learningResourceType', 'educationalLevels', 'creators']);
const PAIRED_FIELDS = {
  gradeLevels: 'gradeLevelLabels',
  schoolTypes: 'schoolTypeLabels',
  didacticConcepts: 'didacticConceptLabels',
  methods: 'methodLabels'
};
const STRING_ARRAY_FIELDS = new Set(['keywords', 'bibleReferences']);
const ABOUT_BY_VOCAB_FIELDS = new Set(['ekwFachrichtung']);

function toFormConcepts(arr) {
  return arr.map((c) => ({ id: c.id, label: c.prefLabel ?? c.label ?? '' }));
}

/** Merge concept arrays (id-keyed) preserving the user's existing entries. */
function mergeConceptArrays(userArr, aiArr) {
  const out = [...userArr];
  const have = new Set(userArr.map((c) => c.id));
  for (const c of aiArr) {
    if (!have.has(c.id)) out.push({ id: c.id, label: c.prefLabel ?? c.label ?? '' });
  }
  return out;
}

function mergeStringArrays(userArr, aiArr) {
  const seen = new Set(userArr);
  const out = [...userArr];
  for (const s of aiArr)
    if (!seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
  return out;
}

/**
 * @param {string} field
 * @param {'replace' | 'merge' | 'dismiss'} action
 * @param {Record<string, any>} formData
 * @param {Record<string, Array<{id: string, label?: string}>>} aboutByVocab
 * @param {{payload: Record<string, any>, evidence?: Record<string, string>}} aiSuggestions
 * @param {Record<string, {source: string, evidence?: string}>} provenance
 * @returns {{formData: any, aboutByVocab: any, provenance: any}}
 */
export function applySuggestionAction(
  field,
  action,
  formData,
  aboutByVocab,
  aiSuggestions,
  provenance
) {
  if (action === 'dismiss') {
    return {
      formData: { ...formData },
      aboutByVocab: { ...aboutByVocab },
      provenance: { ...provenance }
    };
  }

  const payload = aiSuggestions?.payload ?? {};
  const evidence = aiSuggestions?.evidence ?? {};
  const aiValue = payload[field];
  const quote = evidence[field];
  const newProvenance = {
    ...provenance,
    [field]:
      typeof quote === 'string' && quote.length > 0
        ? { source: 'llm-enriched', evidence: quote }
        : { source: 'llm-enriched' }
  };

  let nextFormData = { ...formData };
  let nextAboutByVocab = { ...aboutByVocab };

  if (ABOUT_BY_VOCAB_FIELDS.has(field)) {
    const user = aboutByVocab?.[field] ?? [];
    const aiArr = Array.isArray(aiValue) ? aiValue : [];
    nextAboutByVocab = {
      ...aboutByVocab,
      [field]: action === 'merge' ? mergeConceptArrays(user, aiArr) : toFormConcepts(aiArr)
    };
  } else if (CONCEPT_ARRAY_FIELDS.has(field)) {
    const user = formData?.[field] ?? [];
    const aiArr = Array.isArray(aiValue) ? aiValue : [];
    nextFormData[field] =
      action === 'merge' ? mergeConceptArrays(user, aiArr) : toFormConcepts(aiArr);
  } else if (PAIRED_FIELDS[field]) {
    const labelsKey = PAIRED_FIELDS[field];
    const aiArr = Array.isArray(aiValue) ? aiValue : [];
    if (action === 'merge') {
      const userLabels = formData?.[labelsKey] ?? [];
      const merged = mergeConceptArrays(userLabels, aiArr);
      nextFormData[field] = merged.map((c) => c.id);
      nextFormData[labelsKey] = merged;
    } else {
      const concepts = toFormConcepts(aiArr);
      nextFormData[field] = concepts.map((c) => c.id);
      nextFormData[labelsKey] = concepts;
    }
  } else if (STRING_ARRAY_FIELDS.has(field)) {
    const user = formData?.[field] ?? [];
    // bibleReferences: drop the [''] sentinel before merging
    const userClean =
      field === 'bibleReferences' && user.length === 1 && user[0] === '' ? [] : user;
    const aiArr = Array.isArray(aiValue) ? aiValue : [];
    nextFormData[field] = action === 'merge' ? mergeStringArrays(userClean, aiArr) : [...aiArr];
  } else {
    // String fields
    nextFormData[field] = aiValue;
  }

  return { formData: nextFormData, aboutByVocab: nextAboutByVocab, provenance: newProvenance };
}
