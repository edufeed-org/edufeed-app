import { describe, it, expect } from 'vitest';
import { EKW_KEYWORD_SUGGESTIONS, matchKeywordSuggestions } from '../ekwKeywords.js';

describe('EKW_KEYWORD_SUGGESTIONS', () => {
  it('is non-empty', () => {
    expect(EKW_KEYWORD_SUGGESTIONS.length).toBeGreaterThan(0);
  });

  it('contains a known parent term ("Gott")', () => {
    expect(EKW_KEYWORD_SUGGESTIONS).toContain('Gott');
  });

  it('contains a known child term ("Trinität")', () => {
    expect(EKW_KEYWORD_SUGGESTIONS).toContain('Trinität');
  });

  it('is deduplicated', () => {
    expect(new Set(EKW_KEYWORD_SUGGESTIONS).size).toBe(EKW_KEYWORD_SUGGESTIONS.length);
  });

  it('is sorted using German locale-aware compare', () => {
    const resorted = [...EKW_KEYWORD_SUGGESTIONS].sort((a, b) => a.localeCompare(b, 'de'));
    expect(resorted).toEqual([...EKW_KEYWORD_SUGGESTIONS]);
  });

  it('every entry is a plain string', () => {
    for (const k of EKW_KEYWORD_SUGGESTIONS) {
      expect(typeof k).toBe('string');
    }
  });

  it('collapses duplicates that appear under multiple parents', () => {
    const abendmahl = EKW_KEYWORD_SUGGESTIONS.filter((k) => k === 'Abendmahl');
    const gottesdienst = EKW_KEYWORD_SUGGESTIONS.filter((k) => k === 'Gottesdienst');
    expect(abendmahl).toHaveLength(1);
    expect(gottesdienst).toHaveLength(1);
  });

  it('includes childless parents (e.g. Schöpfung)', () => {
    expect(EKW_KEYWORD_SUGGESTIONS).toContain('Schöpfung');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(EKW_KEYWORD_SUGGESTIONS)).toBe(true);
  });
});

describe('matchKeywordSuggestions', () => {
  it('returns [] for an empty query', () => {
    expect(matchKeywordSuggestions('', [])).toEqual([]);
  });

  it('returns [] for a whitespace-only query', () => {
    expect(matchKeywordSuggestions('   ', [])).toEqual([]);
    expect(matchKeywordSuggestions('\t\n', [])).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const lower = matchKeywordSuggestions('gott', []);
    const upper = matchKeywordSuggestions('GOTT', []);
    const mixed = matchKeywordSuggestions('GoTt', []);
    expect(lower).toContain('Gott');
    expect(upper).toEqual(lower);
    expect(mixed).toEqual(lower);
  });

  it('matches accent-insensitively (umlauts)', () => {
    // 'trin' should match 'Trinität'
    const matches = matchKeywordSuggestions('trin', []);
    expect(matches).toContain('Trinität');
  });

  it('matches against accent-stripped candidates', () => {
    // Searching with diacritics should still match equivalents that have them.
    const matches = matchKeywordSuggestions('Trinitat', []);
    expect(matches).toContain('Trinität');
  });

  it('matches as a substring (not just prefix)', () => {
    // 'frieden' should match 'Frieden' (and not require start-of-word).
    const matches = matchKeywordSuggestions('frieden', []);
    expect(matches).toContain('Frieden');
  });

  it('excludes already-selected keywords (array)', () => {
    const all = matchKeywordSuggestions('gott', []);
    const filtered = matchKeywordSuggestions('gott', ['Gott']);
    expect(all).toContain('Gott');
    expect(filtered).not.toContain('Gott');
  });

  it('excludes already-selected keywords (Set)', () => {
    const filtered = matchKeywordSuggestions('gott', new Set(['Gott']));
    expect(filtered).not.toContain('Gott');
  });

  it('caps results at the default limit (8)', () => {
    // 'e' is a common letter — should easily exceed 8 matches.
    const matches = matchKeywordSuggestions('e', []);
    expect(matches.length).toBeLessThanOrEqual(8);
    expect(matches.length).toBe(8);
  });

  it('respects a configurable limit', () => {
    const matches = matchKeywordSuggestions('e', [], 3);
    expect(matches).toHaveLength(3);
  });

  it('preserves the source order from EKW_KEYWORD_SUGGESTIONS', () => {
    const matches = matchKeywordSuggestions('e', [], 50);
    const expected = EKW_KEYWORD_SUGGESTIONS.filter((k) =>
      k
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes('e')
    ).slice(0, 50);
    expect(matches).toEqual(expected);
  });

  it('returns an array (not a frozen reference to the source)', () => {
    const matches = matchKeywordSuggestions('gott', []);
    expect(Array.isArray(matches)).toBe(true);
    expect(Object.isFrozen(matches)).toBe(false);
  });
});
