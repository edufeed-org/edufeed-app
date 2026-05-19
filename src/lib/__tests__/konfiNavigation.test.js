/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  advanceStepOrSubStep,
  retreatStepOrSubStep,
  jumpToStep
} from '$lib/helpers/educational/konfiNavigation.js';

const KONFI_SUB_STEPS = [
  { key: 'bildungsbereich' },
  { key: 'audience' },
  { key: 'classification' }
];

describe('advanceStepOrSubStep', () => {
  it('advances from step 3 to step 4 first sub-step when konfi sub-steps exist', () => {
    expect(advanceStepOrSubStep({ currentStep: 3, currentSubStep: null }, KONFI_SUB_STEPS)).toEqual(
      { currentStep: 4, currentSubStep: 'bildungsbereich' }
    );
  });

  it('advances within step 4 sub-steps', () => {
    expect(
      advanceStepOrSubStep({ currentStep: 4, currentSubStep: 'bildungsbereich' }, KONFI_SUB_STEPS)
    ).toEqual({ currentStep: 4, currentSubStep: 'audience' });
  });

  it('advances from last sub-step to step 5', () => {
    expect(
      advanceStepOrSubStep({ currentStep: 4, currentSubStep: 'classification' }, KONFI_SUB_STEPS)
    ).toEqual({ currentStep: 5, currentSubStep: null });
  });

  it('advances normally when no sub-steps configured (AMB)', () => {
    expect(advanceStepOrSubStep({ currentStep: 3, currentSubStep: null }, undefined)).toEqual({
      currentStep: 4,
      currentSubStep: null
    });
  });
});

describe('retreatStepOrSubStep', () => {
  it('retreats from step 5 back to last konfi sub-step', () => {
    expect(retreatStepOrSubStep({ currentStep: 5, currentSubStep: null }, KONFI_SUB_STEPS)).toEqual(
      { currentStep: 4, currentSubStep: 'classification' }
    );
  });
});

describe('jumpToStep', () => {
  it('jumps to step 4 first sub-step when konfi sub-steps exist', () => {
    expect(jumpToStep(4, KONFI_SUB_STEPS)).toEqual({
      currentStep: 4,
      currentSubStep: 'bildungsbereich'
    });
  });

  it('jumps to step 4 with null sub-step when no sub-steps configured (AMB)', () => {
    expect(jumpToStep(4, undefined)).toEqual({
      currentStep: 4,
      currentSubStep: null
    });
  });

  it('jumps to step 4 with null sub-step when sub-steps array is empty', () => {
    expect(jumpToStep(4, [])).toEqual({
      currentStep: 4,
      currentSubStep: null
    });
  });

  it('jumps to non-step-4 steps with null sub-step regardless of konfi config', () => {
    expect(jumpToStep(1, KONFI_SUB_STEPS)).toEqual({ currentStep: 1, currentSubStep: null });
    expect(jumpToStep(2, KONFI_SUB_STEPS)).toEqual({ currentStep: 2, currentSubStep: null });
    expect(jumpToStep(3, KONFI_SUB_STEPS)).toEqual({ currentStep: 3, currentSubStep: null });
    expect(jumpToStep(5, KONFI_SUB_STEPS)).toEqual({ currentStep: 5, currentSubStep: null });
  });
});
