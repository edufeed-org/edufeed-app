/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formDataToKonfiTags } from '$lib/helpers/educational/formDataToKonfiTags.js';

/** @type {import('$lib/helpers/educational/bildungsbereich.js').SubStepConfig[]} */
const SUB_STEPS = [
  {
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
  },
  {
    key: '4b',
    titleKey: 'k',
    fields: [
      {
        kind: 'vocab',
        schemeKey: 'konfiThemen',
        tagSlug: 'themen',
        labelKey: 'konfi_field_themen',
        multi: true
      },
      { kind: 'scalar', tagSlug: 'subtitle', labelKey: 'konfi_field_subtitle', input: 'text' },
      {
        kind: 'scalar',
        tagSlug: 'plainLanguage',
        labelKey: 'konfi_field_plain_language',
        input: 'checkbox'
      }
    ]
  }
];

describe('formDataToKonfiTags', () => {
  it('emits vocab triples + scalar + Bildungsbereich L/l pair', () => {
    const formData = {
      konfiZielgruppenIds: ['urn:ku3'],
      konfiZielgruppenLabels: [{ id: 'urn:ku3', label: 'KU3' }],
      konfiThemenIds: ['urn:t1'],
      konfiThemenLabels: [{ id: 'urn:t1', label: 'Thema 1' }],
      subtitle: 'My title',
      plainLanguage: true
    };
    const tags = formDataToKonfiTags(formData, SUB_STEPS, 'konfi');
    expect(tags).toEqual([
      ['ext:ekw:konfi:zielgruppen:id', 'urn:ku3'],
      ['ext:ekw:konfi:zielgruppen:prefLabel:de', 'KU3'],
      ['ext:ekw:konfi:zielgruppen:type', 'Concept'],
      ['ext:ekw:konfi:themen:id', 'urn:t1'],
      ['ext:ekw:konfi:themen:prefLabel:de', 'Thema 1'],
      ['ext:ekw:konfi:themen:type', 'Concept'],
      ['ext:ekw:konfi:subtitle', 'My title'],
      ['ext:ekw:konfi:plainLanguage', 'true'],
      ['L', 'https://edufeed.org/ns/bildungsbereich#'],
      ['l', 'konfi', 'https://edufeed.org/ns/bildungsbereich#']
    ]);
  });

  it('omits L/l tags when bildungsbereichTag is undefined', () => {
    const tags = formDataToKonfiTags({}, [], undefined);
    expect(tags).toEqual([]);
  });

  it('emits only L/l for an empty form (no field data)', () => {
    const tags = formDataToKonfiTags({}, SUB_STEPS, 'konfi');
    expect(tags).toEqual([
      ['L', 'https://edufeed.org/ns/bildungsbereich#'],
      ['l', 'konfi', 'https://edufeed.org/ns/bildungsbereich#']
    ]);
  });
});
