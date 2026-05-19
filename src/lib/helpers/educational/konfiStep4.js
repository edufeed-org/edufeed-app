import * as m from '$lib/paraglide/messages';

/**
 * @typedef {import('./konfiTags.js').SubStepConfig} SubStepConfig
 * @typedef {import('$lib/helpers/forms.js').FormField} FormField
 */

/**
 * Resolve a Paraglide message key to its translated string. Returns the raw
 * key as a fallback if the message doesn't exist (visible degradation, not a
 * crash). Same pattern used by `ExtensionMetadataPanel.svelte`'s `translate()`.
 *
 * @param {string} key
 * @returns {string}
 */
function resolveLabel(key) {
  const messages = /** @type {Record<string, any>} */ (m);
  const fn = Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : undefined;
  return typeof fn === 'function' ? fn() : key;
}

/**
 * Map a sub-step config into the `FormField[]` shape `FieldsRenderer` consumes.
 *
 * Vocab fields whose `schemeKey` doesn't appear in `schemeNaddrs` are dropped
 * silently — matches `FormConceptPicker`'s expectation that a `field.vocab`
 * always resolves. The drift catcher unit test asserts there are no gaps for
 * Konfi at CI time.
 *
 * Each field's `labelKey` is resolved against Paraglide at call time so the
 * downstream renderer receives a real string — no contract change to
 * `FieldsRenderer`.
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
      if (f.allowCustom) {
        options.allowCustom = true;
        if (f.customLabelKey) options.customLabel = resolveLabel(f.customLabelKey);
        if (f.customButtonLabelKey)
          options.customButtonLabel = resolveLabel(f.customButtonLabelKey);
        if (f.customPlaceholderKey)
          options.customPlaceholder = resolveLabel(f.customPlaceholderKey);
      }
      fields.push({
        id: f.schemeKey,
        type: 'vocab',
        label: resolveLabel(f.labelKey),
        vocab,
        options
      });
    } else {
      fields.push({
        id: f.tagSlug,
        type: f.input,
        label: resolveLabel(f.labelKey),
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
