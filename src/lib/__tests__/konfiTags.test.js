/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { emitKonfiVocabTags, emitKonfiScalarTags } from '$lib/helpers/educational/konfiTags.js';

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
