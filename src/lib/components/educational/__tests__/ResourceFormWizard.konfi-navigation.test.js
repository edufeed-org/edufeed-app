/**
 * Konfi step-4 sub-step navigation contract.
 *
 * Mounts the wizard with Konfi as the active Bildungsbereich and asserts:
 *   1. Entering step 4 lands on sub-step 4a.
 *   2. `nextStep` walks 4a → 4b → 4c, then advances to step 5.
 *   3. `prevStep` walks the reverse and re-enters step 4 on 4c.
 *   4. Non-Konfi Bildungsbereich (schule) sets currentSubStep to null on step 4.
 *
 * Full wizard mount is heavy. This test exercises a focused harness around
 * the nav helpers exposed by a small extract. If the wizard does not expose
 * its nav helpers, refactor `nextStep`/`prevStep` into a pure helper module
 * `src/lib/helpers/educational/konfiNavigation.js` and test the helper
 * directly.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  advanceStepOrSubStep,
  retreatStepOrSubStep
} from '$lib/helpers/educational/konfiNavigation.js';

const STEP4_SUB = [
  { key: '4a', titleKey: 'k', fields: [] },
  { key: '4b', titleKey: 'k', fields: [] },
  { key: '4c', titleKey: 'k', fields: [] }
];

describe('konfi step-4 navigation', () => {
  it('next from step 3 lands on step 4 / sub-step 4a', () => {
    expect(advanceStepOrSubStep({ currentStep: 3, currentSubStep: null }, STEP4_SUB)).toEqual({
      currentStep: 4,
      currentSubStep: '4a'
    });
  });

  it('next from 4a → 4b → 4c → step 5 (sub-step cleared)', () => {
    /** @type {import('$lib/helpers/educational/konfiNavigation.js').WizardNavState} */
    let s = { currentStep: 4, currentSubStep: '4a' };
    s = advanceStepOrSubStep(s, STEP4_SUB);
    expect(s).toEqual({ currentStep: 4, currentSubStep: '4b' });
    s = advanceStepOrSubStep(s, STEP4_SUB);
    expect(s).toEqual({ currentStep: 4, currentSubStep: '4c' });
    s = advanceStepOrSubStep(s, STEP4_SUB);
    expect(s).toEqual({ currentStep: 5, currentSubStep: null });
  });

  it('prev from step 5 re-enters step 4 on sub-step 4c', () => {
    expect(retreatStepOrSubStep({ currentStep: 5, currentSubStep: null }, STEP4_SUB)).toEqual({
      currentStep: 4,
      currentSubStep: '4c'
    });
  });

  it('prev walks 4c → 4b → 4a → step 3', () => {
    /** @type {import('$lib/helpers/educational/konfiNavigation.js').WizardNavState} */
    let s = { currentStep: 4, currentSubStep: '4c' };
    s = retreatStepOrSubStep(s, STEP4_SUB);
    expect(s).toEqual({ currentStep: 4, currentSubStep: '4b' });
    s = retreatStepOrSubStep(s, STEP4_SUB);
    expect(s).toEqual({ currentStep: 4, currentSubStep: '4a' });
    s = retreatStepOrSubStep(s, STEP4_SUB);
    expect(s).toEqual({ currentStep: 3, currentSubStep: null });
  });

  it('non-konfi (no sub-steps) advances step 3 → 4 with subStep null', () => {
    expect(advanceStepOrSubStep({ currentStep: 3, currentSubStep: null }, undefined)).toEqual({
      currentStep: 4,
      currentSubStep: null
    });
  });

  it('non-konfi step 4 → 5 with subStep null', () => {
    expect(advanceStepOrSubStep({ currentStep: 4, currentSubStep: null }, undefined)).toEqual({
      currentStep: 5,
      currentSubStep: null
    });
  });
});
