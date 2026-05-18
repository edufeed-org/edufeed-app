// @ts-nocheck
import { validateField } from '$lib/helpers/forms.js';
import { subStepToFormFields, validateKonfiTopicOrDimension } from './konfiStep4.js';
/**
 * Pure validation helper for the resource-form wizard.
 *
 * Returns a `{ fieldKey: errorMessage }` map for the given step. Each field
 * key matches the form-data shape, with a few synthetic keys for cross-
 * field aggregates (`about`, `attachments`).
 *
 * The helper is locale-agnostic: the caller passes a `messages` bag of
 * thunks (typically the wizard's Paraglide functions). This keeps the
 * helper testable in plain Node and decouples validation from i18n.
 *
 * @typedef {{
 *   bildungsbereich: () => string,
 *   urlRequired: () => string,
 *   identifier: () => string,
 *   title: () => string,
 *   description: () => string,
 *   resourceType: () => string,
 *   subject: () => string,
 *   noUrlNeedsAttachment: () => string,
 *   license: () => string,
 * }} ValidationMessages
 *
 * @typedef {{
 *   isEkw: boolean,
 *   hasNoUrl: boolean,
 *   hasSubjectVocab: boolean,
 *   subjectsCount: number,
 *   isValidUrl: (s: string) => boolean,
 *   messages: ValidationMessages,
 *   schemeNaddrs?: Record<string, { address: string, relay: string }>,
 * }} ValidationContext
 */

/**
 * @param {number} step
 * @param {any} formData
 * @param {ValidationContext} ctx
 * @param {import('./konfiTags.js').SubStepConfig} [subStepConfig]
 * @returns {Record<string, string>}
 */
export function validateWizardStep(step, formData, ctx, subStepConfig) {
  const errors = /** @type {Record<string, string>} */ ({});
  const m = ctx.messages;

  switch (step) {
    case 1:
      if (!formData.bildungsbereich) errors.bildungsbereich = m.bildungsbereich();
      break;

    case 2:
      if (!ctx.hasNoUrl && !formData.identifier?.trim()) {
        errors.identifier = m.urlRequired();
      }
      break;

    case 3:
      if (formData.identifier?.trim() && !ctx.isValidUrl(formData.identifier)) {
        errors.identifier = m.identifier();
      }
      if (!formData.name?.trim()) errors.name = m.title();
      if (!formData.description?.trim()) errors.description = m.description();
      break;

    case 4:
      if (subStepConfig) {
        const schemeNaddrs = ctx.schemeNaddrs || {};
        const fields = subStepToFormFields(subStepConfig, schemeNaddrs);
        for (const field of fields) {
          // For vocab: read the *Ids slot (subStepToFormFields uses schemeKey as id)
          const value = field.vocab ? formData[`${field.id}Ids`] || [] : formData[field.id];
          const err = validateField(field, value);
          if (err) errors[field.id] = err;
        }
        if (subStepConfig.key === '4b') {
          const groupErr = validateKonfiTopicOrDimension(formData);
          if (groupErr) errors._topicOrDimension = groupErr;
        }
      } else {
        if (!formData.learningResourceType || formData.learningResourceType.length === 0) {
          errors.learningResourceType = m.resourceType();
        }
        if (ctx.hasSubjectVocab && ctx.subjectsCount === 0) {
          errors.about = m.subject();
        }
      }
      break;

    case 5: {
      const encodings = formData.encodings?.length ?? 0;
      const urls = formData.externalUrls?.length ?? 0;
      if (ctx.hasNoUrl && encodings === 0 && urls === 0) {
        errors.attachments = m.noUrlNeedsAttachment();
      }
      break;
    }

    case 7:
      if (!formData.license) errors.license = m.license();
      break;

    // 6 (relations) and 8 (share) have no required fields.
  }

  return errors;
}
