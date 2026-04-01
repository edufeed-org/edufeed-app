/**
 * SKOS Label Language Fallback Tests
 *
 * Tests the getLabelsWithFallback() function's fallback chain:
 * 1. User's preferred language tag → no fallbackLang
 * 2. English tag → fallbackLang: 'en' (when userLang != 'en')
 * 3. Any other available language tag → fallbackLang: that lang
 * 4. SKOS concept lookup → fallbackLang tracking
 * 5. URI extraction → no fallbackLang (slug has no meaningful language)
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  extractLabelFromUri: (/** @type {string} */ uri) => {
    try {
      const url = new URL(uri);
      const parts = url.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || uri;
    } catch {
      return uri;
    }
  }
}));

import {
  getLabelsWithFallback,
  getLanguageDisplayName
} from '$lib/helpers/educational/ambTransform.js';

describe('getLabelsWithFallback', () => {
  it('returns label with no fallbackLang when user language is available', () => {
    const tags = [
      ['about:id', 'https://example.org/math'],
      ['about:prefLabel:de', 'Mathematik'],
      ['about:prefLabel:en', 'Mathematics']
    ];

    const result = getLabelsWithFallback(tags, 'about', 'de');

    expect(result).toEqual([{ id: 'https://example.org/math', label: 'Mathematik' }]);
    expect(result[0]).not.toHaveProperty('fallbackLang');
  });

  it('falls back to English with fallbackLang when userLang is not "en"', () => {
    const tags = [
      ['about:id', 'https://example.org/math'],
      ['about:prefLabel:en', 'Mathematics']
    ];

    const result = getLabelsWithFallback(tags, 'about', 'fr');

    expect(result).toEqual([
      { id: 'https://example.org/math', label: 'Mathematics', fallbackLang: 'en' }
    ]);
  });

  it('falls back to German tags when userLang is "en" and no English tag exists', () => {
    const tags = [
      ['about:id', 'https://example.org/math'],
      ['about:prefLabel:de', 'Mathematik']
    ];

    const result = getLabelsWithFallback(tags, 'about', 'en');

    expect(result).toEqual([
      { id: 'https://example.org/math', label: 'Mathematik', fallbackLang: 'de' }
    ]);
  });

  it('falls back to any available language tag when neither userLang nor English exist', () => {
    const tags = [
      ['about:id', 'https://example.org/math'],
      ['about:prefLabel:es', 'Matematicas']
    ];

    const result = getLabelsWithFallback(tags, 'about', 'en');

    expect(result).toEqual([
      { id: 'https://example.org/math', label: 'Matematicas', fallbackLang: 'es' }
    ]);
  });

  it('prefers English fallback over other languages when userLang is not available', () => {
    const tags = [
      ['about:id', 'https://example.org/math'],
      ['about:prefLabel:en', 'Mathematics'],
      ['about:prefLabel:de', 'Mathematik']
    ];

    const result = getLabelsWithFallback(tags, 'about', 'fr');

    expect(result).toEqual([
      { id: 'https://example.org/math', label: 'Mathematics', fallbackLang: 'en' }
    ]);
  });

  it('uses SKOS concept lookup with fallbackLang tracking', () => {
    const tags = [['about:id', 'https://example.org/math']];
    const concepts = [
      {
        id: 'https://example.org/math',
        labels: { de: 'Mathematik', en: 'Mathematics' }
      }
    ];

    // userLang='fr' → not in concept → falls back to en
    const result = getLabelsWithFallback(tags, 'about', 'fr', concepts);

    expect(result).toEqual([
      { id: 'https://example.org/math', label: 'Mathematics', fallbackLang: 'en' }
    ]);
  });

  it('uses SKOS concept in userLang without fallbackLang', () => {
    const tags = [['about:id', 'https://example.org/math']];
    const concepts = [
      {
        id: 'https://example.org/math',
        labels: { de: 'Mathematik', en: 'Mathematics' }
      }
    ];

    const result = getLabelsWithFallback(tags, 'about', 'en', concepts);

    expect(result).toEqual([{ id: 'https://example.org/math', label: 'Mathematics' }]);
    expect(result[0]).not.toHaveProperty('fallbackLang');
  });

  it('SKOS concept falls back to German with fallbackLang', () => {
    const tags = [['about:id', 'https://example.org/math']];
    const concepts = [
      {
        id: 'https://example.org/math',
        labels: { de: 'Mathematik' }
      }
    ];

    const result = getLabelsWithFallback(tags, 'about', 'en', concepts);

    expect(result).toEqual([
      { id: 'https://example.org/math', label: 'Mathematik', fallbackLang: 'de' }
    ]);
  });

  it('URI extraction fallback has no fallbackLang', () => {
    const tags = [['about:id', 'https://w3id.org/kim/hochschulfaechersystematik/n270']];

    const result = getLabelsWithFallback(tags, 'about', 'en');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('https://w3id.org/kim/hochschulfaechersystematik/n270');
    expect(result[0].label).toBe('n270');
    expect(result[0]).not.toHaveProperty('fallbackLang');
  });

  it('handles mixed availability across multiple items', () => {
    const tags = [
      ['about:id', 'https://example.org/math'],
      ['about:id', 'https://example.org/physics'],
      ['about:id', 'https://example.org/chemistry'],
      ['about:prefLabel:en', 'Mathematics'],
      // No English for physics, only German
      ['about:prefLabel:de', 'Mathematik-DE'],
      ['about:prefLabel:de', 'Physik'],
      ['about:prefLabel:de', 'Chemie']
      // No English for chemistry either
    ];

    const result = getLabelsWithFallback(tags, 'about', 'en');

    expect(result).toEqual([
      { id: 'https://example.org/math', label: 'Mathematics' },
      { id: 'https://example.org/physics', label: 'Physik', fallbackLang: 'de' },
      { id: 'https://example.org/chemistry', label: 'Chemie', fallbackLang: 'de' }
    ]);
    // First item should NOT have fallbackLang
    expect(result[0]).not.toHaveProperty('fallbackLang');
  });

  it('tag fallback takes priority over SKOS concept lookup', () => {
    const tags = [
      ['about:id', 'https://example.org/math'],
      ['about:prefLabel:de', 'Mathematik']
    ];
    const concepts = [
      {
        id: 'https://example.org/math',
        labels: { fr: 'Mathematiques' }
      }
    ];

    // userLang='en', German tag should be preferred over SKOS French
    const result = getLabelsWithFallback(tags, 'about', 'en', concepts);

    expect(result).toEqual([
      { id: 'https://example.org/math', label: 'Mathematik', fallbackLang: 'de' }
    ]);
  });

  it('works with learningResourceType prefix', () => {
    const tags = [
      ['learningResourceType:id', 'https://w3id.org/kim/hcrt/text'],
      ['learningResourceType:prefLabel:de', 'Textdokument']
    ];

    const result = getLabelsWithFallback(tags, 'learningResourceType', 'en');

    expect(result).toEqual([
      {
        id: 'https://w3id.org/kim/hcrt/text',
        label: 'Textdokument',
        fallbackLang: 'de'
      }
    ]);
  });

  it('skips URI values in prefLabel tags and falls through to SKOS lookup', () => {
    // Some external publishers write the concept URI into prefLabel tags
    const tags = [
      ['about:id', 'https://w3id.org/kim/hochschulfaechersystematik/n091'],
      ['about:prefLabel:de', 'https://w3id.org/kim/hochschulfaechersystematik/n091'],
      ['learningResourceType:id', 'https://w3id.org/kim/hcrt/drill_and_practice'],
      ['learningResourceType:prefLabel:de', 'https://w3id.org/kim/hcrt/drill_and_practice']
    ];
    const aboutConcepts = [
      {
        id: 'https://w3id.org/kim/hochschulfaechersystematik/n091',
        labels: { de: 'Germanistik', en: 'German Studies' }
      }
    ];
    const lrtConcepts = [
      {
        id: 'https://w3id.org/kim/hcrt/drill_and_practice',
        labels: { de: 'Übung', en: 'Drill and Practice' }
      }
    ];

    // Should skip the URI in prefLabel and resolve from SKOS concepts instead
    const aboutResult = getLabelsWithFallback(tags, 'about', 'de', aboutConcepts);
    expect(aboutResult).toEqual([
      { id: 'https://w3id.org/kim/hochschulfaechersystematik/n091', label: 'Germanistik' }
    ]);

    const lrtResult = getLabelsWithFallback(tags, 'learningResourceType', 'de', lrtConcepts);
    expect(lrtResult).toEqual([
      { id: 'https://w3id.org/kim/hcrt/drill_and_practice', label: 'Übung' }
    ]);
  });

  it('deduplicates IDs when event has repeated tags', () => {
    const tags = [
      ['about:id', 'https://w3id.org/kim/hochschulfaechersystematik/n0128'],
      ['about:id', 'https://w3id.org/kim/hochschulfaechersystematik/n0128'],
      ['about:id', 'https://w3id.org/kim/hochschulfaechersystematik/n270'],
      ['about:prefLabel:de', 'Bauingenieurwesen'],
      ['about:prefLabel:de', 'Bauingenieurwesen'],
      ['about:prefLabel:de', 'Informatik']
    ];

    const result = getLabelsWithFallback(tags, 'about', 'de');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'https://w3id.org/kim/hochschulfaechersystematik/n0128',
      label: 'Bauingenieurwesen'
    });
    expect(result[1]).toEqual({
      id: 'https://w3id.org/kim/hochschulfaechersystematik/n270',
      label: 'Informatik'
    });
  });

  it('falls back to URI extraction when prefLabel is URI and no SKOS match', () => {
    const tags = [
      ['about:id', 'https://w3id.org/kim/hochschulfaechersystematik/n091'],
      ['about:prefLabel:de', 'https://w3id.org/kim/hochschulfaechersystematik/n091']
    ];

    // No SKOS concepts available
    const result = getLabelsWithFallback(tags, 'about', 'de', null);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('n091');
    expect(result[0]).not.toHaveProperty('fallbackLang');
  });
});

describe('getLanguageDisplayName', () => {
  it('returns readable name for common language codes', () => {
    expect(getLanguageDisplayName('de', 'en')).toBe('German');
    expect(getLanguageDisplayName('en', 'en')).toBe('English');
    expect(getLanguageDisplayName('fr', 'en')).toBe('French');
  });

  it('respects display locale', () => {
    expect(getLanguageDisplayName('de', 'de')).toBe('Deutsch');
    expect(getLanguageDisplayName('en', 'de')).toBe('Englisch');
  });

  it('returns code for invalid language codes', () => {
    expect(getLanguageDisplayName('xyz_invalid', 'en')).toBe('xyz_invalid');
  });
});
