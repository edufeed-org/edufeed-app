/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { parseKonfiTagsToFormData } from '$lib/helpers/educational/parseKonfiTagsToFormData.js';

/** @type {import('$lib/helpers/educational/bildungsbereich.js').SubStepConfig[]} */
const SUB_STEPS = [
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

describe('parseKonfiTagsToFormData', () => {
  it('extracts vocab + scalar form-data slots from an event', () => {
    const event = {
      tags: [
        ['ext:ekw:konfi:themen:id', 'urn:t1'],
        ['ext:ekw:konfi:themen:prefLabel:de', 'Thema 1'],
        ['ext:ekw:konfi:themen:type', 'Concept'],
        ['ext:ekw:konfi:subtitle', 'Sub'],
        ['ext:ekw:konfi:plainLanguage', 'true']
      ]
    };
    expect(parseKonfiTagsToFormData(event, SUB_STEPS)).toEqual({
      konfiThemenIds: ['urn:t1'],
      konfiThemenLabels: [{ id: 'urn:t1', label: 'Thema 1' }],
      subtitle: 'Sub',
      plainLanguage: true
    });
  });

  it('returns {} for events with no konfi tags', () => {
    expect(parseKonfiTagsToFormData({ tags: [['title', 'x']] }, SUB_STEPS)).toEqual({});
  });
});
