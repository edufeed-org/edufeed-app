/**
 * @typedef {import('./konfiTags.js').SubStepConfig} SubStepConfig
 * @typedef {import('$lib/helpers/forms.js').FormField} FormField
 */

/**
 * Map a sub-step config into the `FormField[]` shape `FieldsRenderer` consumes.
 *
 * Vocab fields whose `schemeKey` doesn't appear in `schemeNaddrs` are dropped
 * silently — matches `FormConceptPicker`'s expectation that a `field.vocab`
 * always resolves. The drift catcher unit test (Task 7) asserts there are no
 * gaps for Konfi at CI time.
 *
 * @param {SubStepConfig} subStep
 * @param {Record<string, { address: string, relay: string }>} schemeNaddrs
 * @returns {FormField[]}
 */
export function subStepToFormFields(subStep, schemeNaddrs) {
  /** @type {FormField[]} */
  const fields = [];
  for (const f of subStep.fields) {
    if (f.kind === 'vocab') {
      const vocab = schemeNaddrs[f.schemeKey];
      if (!vocab) continue;
      /** @type {Record<string, any>} */
      const options = { multiple: f.multi === true };
      if (f.required) options.required = true;
      fields.push({
        id: f.schemeKey,
        type: 'vocab',
        label: f.schemeKey,
        vocab,
        options
      });
    } else {
      fields.push({
        id: f.tagSlug,
        type: f.input,
        label: '',
        options: {}
      });
    }
  }
  return fields;
}

/**
 * Cross-field validator for 4b's `topicOrDimension` XOR group: at least one of
 * `konfiThemenIds` or `konfiDimensionenIds` must be non-empty.
 *
 * @param {Record<string, any>} values
 * @returns {string | null} message key on failure, null on success
 */
export function validateKonfiTopicOrDimension(values) {
  const themen = Array.isArray(values.konfiThemenIds) ? values.konfiThemenIds : [];
  const dim = Array.isArray(values.konfiDimensionenIds) ? values.konfiDimensionenIds : [];
  if (themen.length > 0 || dim.length > 0) return null;
  return 'konfi_topic_or_dimension_required';
}
