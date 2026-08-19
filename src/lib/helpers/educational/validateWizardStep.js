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
 *   noUrlNeedsFile: () => string,
 *   license: () => string,
 *   imageLicenseMissing: () => string,
 *   encodingLicenseMissing: () => string,
 * }} ValidationMessages
 *
 * @typedef {{
 *   isEkw: boolean,
 *   hasNoUrl: boolean,
 *   isEditMode: boolean,
 *   hasSubjectVocab: boolean,
 *   subjectsCount: number,
 *   isValidUrl: (s: string) => boolean,
 *   messages: ValidationMessages,
 *   schemeNaddrs?: Record<string, { address: string, relay: string }>,
 *   variantId?: string,
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
      if (ctx.variantId === 'interactive') {
        // Interactive resources carry their content as a single licensed
        // webxdc package (InteractivePackageInput), not a URL.
        const pkg = (formData.encodings ?? []).find(
          (/** @type {any} */ f) => f?.type === 'application/x-webxdc'
        );
        if (!pkg || !pkg.licenseEvent) errors.attachments = m.noUrlNeedsFile();
        break;
      }
      if (!ctx.hasNoUrl) {
        if (!formData.identifier?.trim()) errors.identifier = m.urlRequired();
      } else if (!ctx.isEditMode && (formData.encodings?.length ?? 0) === 0) {
        // No-URL resources carry their content as an uploaded file. The
        // uploader lives on this step, so enforce "at least one file" here —
        // not on step 5, where the error would surface far from the action.
        // Edit mode hides the step-2 uploader (d-tag is immutable), so the
        // requirement is satisfied by the already-published encodings.
        errors.attachments = m.noUrlNeedsFile();
      }
      break;

    case 3:
      if (formData.identifier?.trim() && !ctx.isValidUrl(formData.identifier)) {
        errors.identifier = m.identifier();
      }
      if (!formData.name?.trim()) errors.name = m.title();
      if (!formData.description?.trim()) errors.description = m.description();
      // Block publish if an uploaded image lacks a license attestation (NIP-94 kind 1063).
      // Pasted URLs (imageWasUploaded=false) are exempt — license accountability falls
      // on whoever hosts the image elsewhere. Cleared images (formData.image empty) pass.
      if (formData.image && formData.imageWasUploaded && !formData.imageLicenseEvent) {
        errors.image = m.imageLicenseMissing();
      }
      if (!formData.license) errors.license = m.license();
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
      // License gate: any encoding with a sha256 but no license event blocks publish.
      const missing = (formData.encodings ?? []).some(
        (/** @type {any} */ e) => e?.sha256 && !e?.licenseEvent
      );
      if (missing) {
        errors.encodings = m.encodingLicenseMissing();
      }
      break;
    }

    // 6 (relations) and 7 (share) have no required fields.
  }

  return errors;
}
