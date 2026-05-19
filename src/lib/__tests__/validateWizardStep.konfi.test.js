/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/event-factory.js', async () => {
  const { EventFactory } = await import('applesauce-core/event-factory');
  return {
    createAppEventFactory: vi.fn((/** @type {any} */ opts) => new EventFactory(opts))
  };
});

import { validateWizardStep } from '$lib/helpers/educational/validateWizardStep.js';

/** @type {Record<string, {address: string, relay: string}>} */
const SCHEME_NADDRS = {
  konfiZielgruppen: { address: '39737:abc:konfi-zielgruppen', relay: '' },
  konfiThemen: { address: '39737:abc:konfi-themen', relay: '' },
  konfiDimensionen: { address: '39737:abc:konfi-dimensionen', relay: '' }
};

const STEP_4A = {
  key: '4a',
  titleKey: 'k',
  fields: [
    {
      kind: 'vocab',
      schemeKey: 'konfiZielgruppen',
      tagSlug: 'zielgruppen',
      labelKey: 'konfi_field_zielgruppen',
      multi: true,
      required: true
    }
  ]
};

const STEP_4B = {
  key: '4b',
  titleKey: 'k',
  fields: [
    {
      kind: 'vocab',
      schemeKey: 'konfiThemen',
      tagSlug: 'themen',
      labelKey: 'konfi_field_themen',
      multi: true,
      requiredOneOf: 'topicOrDimension'
    },
    {
      kind: 'vocab',
      schemeKey: 'konfiDimensionen',
      tagSlug: 'dimensionen',
      labelKey: 'konfi_field_dimensionen',
      multi: true,
      requiredOneOf: 'topicOrDimension'
    }
  ]
};

const STEP_4C = {
  key: '4c',
  titleKey: 'k',
  fields: [
    {
      kind: 'scalar',
      tagSlug: 'requiredMaterialsNote',
      labelKey: 'konfi_field_required_materials_note',
      input: 'textarea'
    }
  ]
};

const baseCtx = {
  isEkw: true,
  hasNoUrl: false,
  hasSubjectVocab: false,
  subjectsCount: 0,
  isValidUrl: () => true,
  messages: {
    bildungsbereich: () => 'b',
    urlRequired: () => 'u',
    identifier: () => 'i',
    title: () => 't',
    description: () => 'd',
    resourceType: () => 'r',
    subject: () => 's',
    noUrlNeedsAttachment: () => 'a',
    license: () => 'l'
  },
  schemeNaddrs: SCHEME_NADDRS
};

describe('validateWizardStep — konfi step 4 sub-steps', () => {
  it('4a flags missing konfiZielgruppen', () => {
    const errors = validateWizardStep(4, { konfiZielgruppenIds: [] }, baseCtx, STEP_4A);
    expect(errors.konfiZielgruppen).toBe('Zielgruppen is required');
  });

  it('4a passes when konfiZielgruppenIds has entries', () => {
    const errors = validateWizardStep(
      4,
      { konfiZielgruppenIds: [{ id: 'urn:x', labels: {} }] },
      baseCtx,
      STEP_4A
    );
    expect(errors.konfiZielgruppen).toBeUndefined();
  });

  it('4b flags _topicOrDimension when both are empty', () => {
    const errors = validateWizardStep(4, {}, baseCtx, STEP_4B);
    expect(errors._topicOrDimension).toBe('konfi_topic_or_dimension_required');
  });

  it('4b passes when themen has entries', () => {
    const errors = validateWizardStep(4, { konfiThemenIds: [{ id: 'urn:t' }] }, baseCtx, STEP_4B);
    expect(errors._topicOrDimension).toBeUndefined();
  });

  it('4c has no required fields', () => {
    const errors = validateWizardStep(4, {}, baseCtx, STEP_4C);
    expect(errors).toEqual({});
  });

  it('non-konfi step 4 (no subStepConfig) preserves existing AMB behavior', () => {
    const errors = validateWizardStep(
      4,
      { learningResourceType: [] },
      { ...baseCtx, isEkw: false }
    );
    expect(errors.learningResourceType).toBe('r');
  });
});
