//
// Pure step/content-type logic for CreateCommunityModal, extracted so the
// wizard's flow is unit-testable without mounting the 1100-line modal.

/**
 * Ordered step ids after the keypair-choice screen (screen 0 of the modal).
 * @param {{useCurrentKeypair: boolean, typeStepVisible: boolean}} args
 * @returns {string[]}
 */
export function communityWizardSteps({ useCurrentKeypair, typeStepVisible }) {
  const identity = useCurrentKeypair ? [] : ['profile', 'keys'];
  const type = typeStepVisible ? ['type'] : [];
  return [...identity, ...type, 'settings', 'confirm'];
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
