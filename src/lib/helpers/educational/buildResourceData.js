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
 *   konfiTags: string[][],
 *   hasNoUrl: boolean
 * }} ctx
 */
export function buildResourceData(formData, { about, konfiTags, hasNoUrl }) {
  return {
    name: formData.name,
    description: formData.description,
    slug: hasNoUrl ? '' : formData.identifier?.trim() || '',
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
    // EKW-variant facets — `formDataToEkwTags` no-ops when these are
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
    konfiTags
  };
}
