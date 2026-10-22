/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  normalizeKeyword,
  normalizeKeywords,
  buildKeywordTags,
  buildSubjectTags,
  getLicenseKeywords,
  getLicenseSubjects,
  getSubjectLabel
} from '$lib/helpers/license-tags.js';

const RELIGION = {
  id: 'http://w3id.org/kim/schulfaecher/s1055',
  labels: { en: 'Religious education', de: 'Religion' }
};
const INFORMATIK = {
  id: 'https://w3id.org/kim/hochschulfaechersystematik/n079',
  labels: { de: 'Informatik' }
};

describe('normalizeKeyword / normalizeKeywords', () => {
  it('lowercases, trims and strips a leading # (NIP-24)', () => {
    expect(normalizeKeyword('  #BarCamp ')).toBe('barcamp');
    expect(normalizeKeyword('Kirche')).toBe('kirche');
    expect(normalizeKeyword('##')).toBe('');
    expect(normalizeKeyword(42)).toBe('');
  });

  it('dedupes after normalisation and drops empties', () => {
    expect(normalizeKeywords(['Kirche', '#kirche', '', ' ', 'church'])).toEqual([
      'kirche',
      'church'
    ]);
    expect(normalizeKeywords(undefined)).toEqual([]);
  });
});

describe('buildKeywordTags', () => {
  it('emits one t tag per keyword', () => {
    expect(buildKeywordTags(['Metadaten', 'holzbausteine', 'metadaten'])).toEqual([
      ['t', 'metadaten'],
      ['t', 'holzbausteine']
    ]);
  });
});

describe('buildSubjectTags', () => {
  it('writes contiguous about:* triples, German label first, one per concept', () => {
    expect(buildSubjectTags([RELIGION, INFORMATIK])).toEqual([
      ['about:id', RELIGION.id],
      ['about:prefLabel:de', 'Religion'],
      ['about:prefLabel:en', 'Religious education'],
      ['about:type', 'Concept'],
      ['about:id', INFORMATIK.id],
      ['about:prefLabel:de', 'Informatik'],
      ['about:type', 'Concept']
    ]);
  });

  it('dedupes by id and skips concepts without an id or labels', () => {
    expect(buildSubjectTags([RELIGION, { ...RELIGION }, { id: '' }, { id: 'urn:x' }])).toEqual([
      ['about:id', RELIGION.id],
      ['about:prefLabel:de', 'Religion'],
      ['about:prefLabel:en', 'Religious education'],
      ['about:type', 'Concept'],
      ['about:id', 'urn:x'],
      ['about:type', 'Concept']
    ]);
    expect(buildSubjectTags(undefined)).toEqual([]);
  });
});

describe('getLicenseKeywords / getLicenseSubjects', () => {
  const event = {
    tags: [
      ['url', 'https://blossom.example/a.jpg'],
      ['t', 'metadaten'],
      ['t', ' holzbausteine '],
      ['t', 'metadaten'],
      ['t', ''],
      ...buildSubjectTags([RELIGION, INFORMATIK]),
      // a stray prefLabel without an opening id is ignored
      ['about:prefLabel:de', 'Verwaist'],
      ['about:id', RELIGION.id],
      ['about:prefLabel:de', 'Religion (dup)']
    ]
  };

  it('reads keywords deduped and trimmed', () => {
    expect(getLicenseKeywords(event)).toEqual(['metadaten', 'holzbausteine']);
    expect(getLicenseKeywords(null)).toEqual([]);
  });

  it('groups the triples by about:id and reads a repeated id once', () => {
    expect(getLicenseSubjects(event)).toEqual([RELIGION, INFORMATIK]);
    expect(getLicenseSubjects({ tags: [] })).toEqual([]);
  });

  it('round-trips through the builder', () => {
    const built = { tags: [...buildKeywordTags(['Kirche']), ...buildSubjectTags([INFORMATIK])] };
    expect(getLicenseKeywords(built)).toEqual(['kirche']);
    expect(getLicenseSubjects(built)).toEqual([INFORMATIK]);
  });
});

describe('getSubjectLabel', () => {
  it('prefers the locale, then de, then en, then the last URI segment', () => {
    expect(getSubjectLabel(RELIGION, 'en')).toBe('Religious education');
    expect(getSubjectLabel(RELIGION, 'fr')).toBe('Religion');
    expect(getSubjectLabel({ id: RELIGION.id, labels: { en: 'RE' } }, 'de')).toBe('RE');
    expect(getSubjectLabel({ id: 'https://w3id.org/kim/x/n079/', labels: {} })).toBe('n079');
    expect(getSubjectLabel({ id: 'https://example.org/vocab#Kunst%20A', labels: {} })).toBe(
      'Kunst A'
    );
  });
});
