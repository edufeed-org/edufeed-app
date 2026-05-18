/**
 * Pure step + sub-step navigation helpers for the resource-form wizard.
 *
 * Keeps the wizard's nextStep / prevStep logic testable in plain node
 * without mounting the full Svelte component.
 *
 * @typedef {{ currentStep: number, currentSubStep: string | null }} WizardNavState
 */

/**
 * @param {WizardNavState} state
 * @param {Array<{ key: string }> | undefined} step4SubSteps
 * @returns {WizardNavState}
 */
export function advanceStepOrSubStep(state, step4SubSteps) {
  const { currentStep, currentSubStep } = state;
  if (currentStep === 4 && step4SubSteps?.length) {
    const idx = step4SubSteps.findIndex((s) => s.key === currentSubStep);
    if (idx >= 0 && idx < step4SubSteps.length - 1) {
      return { currentStep: 4, currentSubStep: step4SubSteps[idx + 1].key };
    }
    return { currentStep: 5, currentSubStep: null };
  }
  const next = currentStep + 1;
  if (next === 4 && step4SubSteps?.length) {
    return { currentStep: 4, currentSubStep: step4SubSteps[0].key };
  }
  return { currentStep: next, currentSubStep: null };
}

/**
 * @param {WizardNavState} state
 * @param {Array<{ key: string }> | undefined} step4SubSteps
 * @returns {WizardNavState}
 */
export function retreatStepOrSubStep(state, step4SubSteps) {
  const { currentStep, currentSubStep } = state;
  if (currentStep === 4 && step4SubSteps?.length) {
    const idx = step4SubSteps.findIndex((s) => s.key === currentSubStep);
    if (idx > 0) {
      return { currentStep: 4, currentSubStep: step4SubSteps[idx - 1].key };
    }
    return { currentStep: 3, currentSubStep: null };
  }
  const prev = currentStep - 1;
  if (prev === 4 && step4SubSteps?.length) {
    return {
      currentStep: 4,
      currentSubStep: step4SubSteps[step4SubSteps.length - 1].key
    };
  }
  return { currentStep: prev, currentSubStep: null };
}
