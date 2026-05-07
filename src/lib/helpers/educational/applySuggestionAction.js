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

  // String fields: replace and merge are equivalent (no merge for strings).
  return {
    formData: { ...formData, [field]: aiValue },
    aboutByVocab: { ...aboutByVocab },
    provenance: newProvenance
  };
}
