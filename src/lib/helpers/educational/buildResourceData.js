import { BILDUNGSBEREICHE } from './bildungsbereich.js';

/**
 * Forward the raw Konfi scheme-key fields formData carries, driven by the
 * SAME static `BILDUNGSBEREICHE.konfi.step4SubSteps` config that
 * `formDataToAmbExt.js` walks when building the `org.edufeed.ekw.konfi` ext
 * namespace. Without this, `buildResourceData` — a WHITELIST — silently
 * drops every Konfi field: `formDataToAmbExt` would see `undefined` for
 * `formData[schemeKey + 'Ids']` etc. and emit zero Konfi facets on publish
 * (see git.edufeed.org/edufeed/edufeed-app#46, and the Task-4 review that
 * caught this specific gap). Config-driven so a new Konfi field can't rot
 * this list silently.
 *
 * @param {Record<string, any>} formData
 * @returns {Record<string, any>}
 */
function collectKonfiRawFields(formData) {
  const subSteps = BILDUNGSBEREICHE.konfi.step4SubSteps ?? [];
  /** @type {Record<string, any>} */
  const out = {};
  for (const step of subSteps) {
    for (const field of step.fields) {
      if (field.kind === 'vocab') {
        out[`${field.schemeKey}Ids`] = formData[`${field.schemeKey}Ids`];
        out[`${field.schemeKey}Labels`] = formData[`${field.schemeKey}Labels`];
        if (field.allowCustom) {
          out[`${field.schemeKey}Custom`] = formData[`${field.schemeKey}Custom`];
        }
      } else {
        out[field.tagSlug] = formData[field.tagSlug];
      }
    }
  }
  return out;
}

/**
 * Assemble the wizard's formData into the `resourceData` shape consumed by
 * `createResource` / `updateResource` (educational-actions).
 *
 * Extracted from ResourceFormWizard's handleSubmit so the field mapping is
 * unit-testable — fields silently missing here never reach the published
 * event (this is exactly how image/dates/curriculum picks got lost, see
 * git.edufeed.org/edufeed/edufeed-app#46).
 *
 * @param {ReturnType<import('./wizardInitialState.js').createInitialFormData>} formData
 * @param {{
 *   about: Array<{id: string, label: string}>,
 *   hasNoUrl: boolean
 * }} ctx
 * @returns {Record<string, any>} Includes the raw Konfi scheme-key fields
 *   spread in by `collectKonfiRawFields` — that part of the shape is
 *   config-driven (see `BILDUNGSBEREICHE.konfi.step4SubSteps`), not a fixed
 *   set of named properties.
 */
export function buildResourceData(formData, { about, hasNoUrl }) {
  return {
    name: formData.name,
    description: formData.description,
    slug: hasNoUrl ? '' : formData.identifier?.trim() || '',
    // Wizard step-1 pick ('schule' | 'hochschule' | 'extra' | 'konfi' | '').
    // Drives the Konfi required-field skip and the Bildungsbereich NIP-32
    // detection tag downstream in educational-actions.svelte.js.
    bildungsbereich: formData.bildungsbereich,
    learningResourceType: formData.learningResourceType[0]?.id || '',
    learningResourceTypeLabel: formData.learningResourceType[0]?.label || '',
    about: about.map((s) => s.id),
    aboutLabels: about.map((s) => ({ id: s.id, label: s.label })),
    educationalLevels: formData.educationalLevels.map((e) => e.id),
    educationalLevelLabels: formData.educationalLevels.map((e) => ({
      id: e.id,
      label: e.label
    })),
    inLanguage: formData.inLanguage,
    license: formData.license,
    coverHue: formData.coverHue,
    // Thumbnail + its NIP-94 license attestation (drives the `image` and
    // `x` tags on the published event).
    image: formData.image,
    imageLicenseEvent: formData.imageLicenseEvent,
    // schema.org/AMB dates entered on step 3.
    datePublished: formData.datePublished,
    dateCreated: formData.dateCreated,
    creators: formData.creators,
    keywords: formData.keywords,
    files: formData.encodings,
    isAccessibleForFree: formData.isAccessibleForFree,
    externalUrls: formData.externalUrls,
    hasPart: formData.hasPart,
    isPartOf: formData.isPartOf,
    // Curriculum relations from the Lehrplan picker (step 6, AMB variant).
    teaches: formData.teaches,
    assesses: formData.assesses,
    competencyRequired: formData.competencyRequired,
    // EKW-variant facets — `formDataToAmbExt` no-ops when these are
    // empty/undefined, so it's safe to forward unconditionally rather
    // than gating on `variantId === 'ekw'`.
    gradeLevels: formData.gradeLevels,
    gradeLevelLabels: formData.gradeLevelLabels,
    schoolTypes: formData.schoolTypes,
    schoolTypeLabels: formData.schoolTypeLabels,
    didacticConcepts: formData.didacticConcepts,
    didacticConceptLabels: formData.didacticConceptLabels,
    methods: formData.methods,
    methodLabels: formData.methodLabels,
    methodOther: formData.methodOther,
    bibleReferences: formData.bibleReferences,
    // Konfi-variant raw facet fields — `formDataToAmbExt` reads these
    // directly (same no-op-when-empty contract as the EKW fields above).
    ...collectKonfiRawFields(formData)
  };
}
