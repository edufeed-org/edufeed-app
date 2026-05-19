/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  emitKonfiVocabTags,
  emitKonfiScalarTags,
  parseKonfiTags
} from '$lib/helpers/educational/konfiTags.js';

describe('emitKonfiVocabTags', () => {
  it('emits the id/prefLabel:de/type triple per concept', () => {
    const concepts = [
      { id: 'https://edufeed.org/ns/konfi-zielgruppen#ku3', labels: { de: 'KU3' } },
      { id: 'https://edufeed.org/ns/konfi-zielgruppen#ku4', labels: { de: 'KU4' } }
    ];
    expect(emitKonfiVocabTags('zielgruppen', concepts)).toEqual([
      ['ext:ekw:konfi:zielgruppen:id', 'https://edufeed.org/ns/konfi-zielgruppen#ku3'],
      ['ext:ekw:konfi:zielgruppen:prefLabel:de', 'KU3'],
      ['ext:ekw:konfi:zielgruppen:type', 'Concept'],
      ['ext:ekw:konfi:zielgruppen:id', 'https://edufeed.org/ns/konfi-zielgruppen#ku4'],
      ['ext:ekw:konfi:zielgruppen:prefLabel:de', 'KU4'],
      ['ext:ekw:konfi:zielgruppen:type', 'Concept']
    ]);
  });

  it('omits prefLabel:de when no de label present', () => {
    const concepts = [{ id: 'urn:x', labels: { en: 'X' } }];
    expect(emitKonfiVocabTags('themen', concepts)).toEqual([
      ['ext:ekw:konfi:themen:id', 'urn:x'],
      ['ext:ekw:konfi:themen:type', 'Concept']
    ]);
  });

  it('returns [] for empty / undefined input', () => {
    expect(emitKonfiVocabTags('zielgruppen', [])).toEqual([]);
    expect(emitKonfiVocabTags('zielgruppen', undefined)).toEqual([]);
  });
});

describe('emitKonfiScalarTags', () => {
  it('emits a single tag for a non-empty string', () => {
    expect(emitKonfiScalarTags('subtitle', 'Konfi-Tag 2026')).toEqual([
      ['ext:ekw:konfi:subtitle', 'Konfi-Tag 2026']
    ]);
  });

  it('emits "true" for true booleans', () => {
    expect(emitKonfiScalarTags('plainLanguage', true)).toEqual([
      ['ext:ekw:konfi:plainLanguage', 'true']
    ]);
  });

  it('returns [] for false / empty string / undefined / null', () => {
    expect(emitKonfiScalarTags('plainLanguage', false)).toEqual([]);
    expect(emitKonfiScalarTags('subtitle', '')).toEqual([]);
    expect(emitKonfiScalarTags('subtitle', undefined)).toEqual([]);
    expect(emitKonfiScalarTags('subtitle', null)).toEqual([]);
  });

  it('trims whitespace-only strings to nothing', () => {
    expect(emitKonfiScalarTags('subtitle', '   ')).toEqual([]);
  });
});

/** @type {import('$lib/helpers/educational/bildungsbereich.js').SubStepConfig[]} */
const SUB_STEPS = [
  {
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
  },
  {
    key: '4b',
    titleKey: 'konfi_step4b_title',
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

describe('parseKonfiTags', () => {
  it('reconstructs Ids + Labels for vocab fields', () => {
    const tags = [
      ['ext:ekw:konfi:zielgruppen:id', 'urn:ku3'],
      ['ext:ekw:konfi:zielgruppen:prefLabel:de', 'KU3'],
      ['ext:ekw:konfi:zielgruppen:type', 'Concept'],
      ['ext:ekw:konfi:zielgruppen:id', 'urn:ku4'],
      ['ext:ekw:konfi:zielgruppen:prefLabel:de', 'KU4'],
      ['ext:ekw:konfi:zielgruppen:type', 'Concept']
    ];
    expect(parseKonfiTags(tags, SUB_STEPS)).toEqual({
      konfiZielgruppenIds: ['urn:ku3', 'urn:ku4'],
      konfiZielgruppenLabels: [
        { id: 'urn:ku3', label: 'KU3' },
        { id: 'urn:ku4', label: 'KU4' }
      ]
    });
  });

  it('falls back label = id when prefLabel:de missing', () => {
    const tags = [
      ['ext:ekw:konfi:themen:id', 'urn:x'],
      ['ext:ekw:konfi:themen:type', 'Concept']
    ];
    expect(parseKonfiTags(tags, SUB_STEPS)).toEqual({
      konfiThemenIds: ['urn:x'],
      konfiThemenLabels: [{ id: 'urn:x', label: 'urn:x' }]
    });
  });

  it('parses scalar string and boolean fields', () => {
    const tags = [
      ['ext:ekw:konfi:subtitle', 'Konfi-Tag 2026'],
      ['ext:ekw:konfi:plainLanguage', 'true']
    ];
    expect(parseKonfiTags(tags, SUB_STEPS)).toEqual({
      subtitle: 'Konfi-Tag 2026',
      plainLanguage: true
    });
  });

  it('returns {} for events with no konfi tags', () => {
    expect(
      parseKonfiTags(
        [
          ['p', 'abc'],
          ['title', 'x']
        ],
        SUB_STEPS
      )
    ).toEqual({});
  });
});

describe('konfi tag round-trip', () => {
  it('emit → parse is stable for vocab + scalar mix', () => {
    const concepts = [
      { id: 'urn:t1', labels: { de: 'Thema 1' } },
      { id: 'urn:t2', labels: { de: 'Thema 2' } }
    ];
    const tags = [
      ...emitKonfiVocabTags('themen', concepts),
      ...emitKonfiScalarTags('subtitle', 'My subtitle'),
      ...emitKonfiScalarTags('plainLanguage', true)
    ];
    expect(parseKonfiTags(tags, SUB_STEPS)).toEqual({
      konfiThemenIds: ['urn:t1', 'urn:t2'],
      konfiThemenLabels: [
        { id: 'urn:t1', label: 'Thema 1' },
        { id: 'urn:t2', label: 'Thema 2' }
      ],
      subtitle: 'My subtitle',
      plainLanguage: true
    });
  });
});
