//
// Pure step/content-type logic for CreateCommunityModal, extracted so the
// wizard's flow is unit-testable without mounting the 1100-line modal.

/**
 * Ordered step ids after the keypair-choice screen (screen 0 of the modal).
 * The 'people' step (invite list) only ever appears for moderated
 * communities, and only when the type step itself is visible — a stray
 * communityType left over from a previous choice must not leak a 'people'
 * step in once the type step collapses away (flags off).
 * @param {{useCurrentKeypair: boolean, typeStepVisible: boolean, communityType?: 'open' | 'moderated' | 'closed'}} args
 * @returns {string[]}
 */
export function communityWizardSteps({ useCurrentKeypair, typeStepVisible, communityType }) {
  const identity = useCurrentKeypair ? [] : ['profile', 'keys'];
  const type = typeStepVisible ? ['type'] : [];
  const people = typeStepVisible && communityType === 'moderated' ? ['people'] : [];
  return [...identity, ...type, 'settings', ...people, 'confirm'];
}

/**
 * @template {Record<string, {access?: object}>} T
 * @param {T} contentTypes
 * @param {'all' | 'members'} tier
 * @returns {T}
 */
export function applyDefaultAccess(contentTypes, tier) {
  return /** @type {T} */ (
    Object.fromEntries(
      Object.entries(contentTypes).map(([key, ct]) => [key, { ...ct, access: { tier } }])
    )
  );
}

/**
 * @template {Record<string, {enabled?: boolean}>} T
 * @param {T} contentTypes
 * @returns {T}
 */
export function disableAllContentTypes(contentTypes) {
  return /** @type {T} */ (
    Object.fromEntries(
      Object.entries(contentTypes).map(([key, ct]) => [key, { ...ct, enabled: false }])
    )
  );
}
