/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  subStepToFormFields,
  validateKonfiTopicOrDimension
} from '$lib/helpers/educational/konfiStep4.js';

/** @type {Record<string, {address: string, relay: string}>} */
const SCHEME_NADDRS = {
  konfiZielgruppen: { address: '39737:abc:konfi-zielgruppen', relay: 'wss://relay.example' },
  konfiThemen: { address: '39737:abc:konfi-themen', relay: 'wss://relay.example' }
};

// Mock Paraglide messages: only `konfi_field_zielgruppen` is "translated"; the
// rest (e.g. `konfi_field_subtitle`) are intentionally missing to exercise the
// raw-key fallback path.
vi.mock('$lib/paraglide/messages', () => ({
  konfi_field_zielgruppen: () => 'Zielgruppen'
}));

describe('subStepToFormFields', () => {
  it('resolves labelKey via Paraglide for vocab fields', () => {
    const subStep = {
      key: '4a',
      titleKey: 'konfi_step4a_title',
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
    expect(subStepToFormFields(subStep, SCHEME_NADDRS)).toEqual([
      {
        id: 'konfiZielgruppen',
        type: 'vocab',
        label: 'Zielgruppen',
        vocab: { address: '39737:abc:konfi-zielgruppen', relay: 'wss://relay.example' },
        options: { multiple: true, required: true }
      }
    ]);
  });

  it('falls back to the raw labelKey when the Paraglide message is missing', () => {
    const subStep = {
      key: '4b',
      titleKey: 'k',
      fields: [
        {
          kind: 'scalar',
          tagSlug: 'subtitle',
          labelKey: 'konfi_field_subtitle',
          input: 'text'
        }
      ]
    };
    expect(subStepToFormFields(subStep, SCHEME_NADDRS)).toEqual([
      { id: 'subtitle', type: 'text', label: 'konfi_field_subtitle', options: {} }
    ]);
  });

  it('skips vocab fields with no scheme naddr (returns no entry)', () => {
    const subStep = {
      key: '4a',
      titleKey: 'k',
      fields: [
        {
          kind: 'vocab',
          schemeKey: 'konfiMissing',
          tagSlug: 'missing',
          labelKey: 'konfi_field_missing',
          multi: true
        }
      ]
    };
    expect(subStepToFormFields(subStep, SCHEME_NADDRS)).toEqual([]);
  });

  it('resolves labelKey on each scalar input type (text / textarea / checkbox)', () => {
    const subStep = {
      key: '4b',
      titleKey: 'k',
      fields: [
        { kind: 'scalar', tagSlug: 'subtitle', labelKey: 'konfi_field_zielgruppen', input: 'text' },
        {
          kind: 'scalar',
          tagSlug: 'requiredMaterialsNote',
          labelKey: 'konfi_field_required_materials_note',
          input: 'textarea'
        },
        {
          kind: 'scalar',
          tagSlug: 'plainLanguage',
          labelKey: 'konfi_field_plain_language',
          input: 'checkbox'
        }
      ]
    };
    expect(subStepToFormFields(subStep, SCHEME_NADDRS)).toEqual([
      // Uses the mocked `konfi_field_zielgruppen` so we can prove resolution works on scalars too.
      { id: 'subtitle', type: 'text', label: 'Zielgruppen', options: {} },
      {
        id: 'requiredMaterialsNote',
        type: 'textarea',
        label: 'konfi_field_required_materials_note',
        options: {}
      },
      {
        id: 'plainLanguage',
        type: 'checkbox',
        label: 'konfi_field_plain_language',
        options: {}
      }
    ]);
  });
});

describe('validateKonfiTopicOrDimension', () => {
  it('returns null when themen has selections', () => {
    expect(
      validateKonfiTopicOrDimension({ konfiThemenIds: ['urn:t1'], konfiDimensionenIds: [] })
    ).toBeNull();
  });

  it('returns null when dimensionen has selections', () => {
    expect(
      validateKonfiTopicOrDimension({ konfiThemenIds: [], konfiDimensionenIds: ['urn:d1'] })
    ).toBeNull();
  });

  it('returns null when both have selections', () => {
    expect(
      validateKonfiTopicOrDimension({
        konfiThemenIds: ['urn:t1'],
        konfiDimensionenIds: ['urn:d1']
      })
    ).toBeNull();
  });

  it('returns the error key when both are empty', () => {
    expect(validateKonfiTopicOrDimension({ konfiThemenIds: [], konfiDimensionenIds: [] })).toBe(
      'konfi_topic_or_dimension_required'
    );
  });

  it('returns the error key when both keys are undefined', () => {
    expect(validateKonfiTopicOrDimension({})).toBe('konfi_topic_or_dimension_required');
  });
});
