import { describe, it, expect } from 'vitest';
import { EKW_KEYWORD_SUGGESTIONS } from '../ekwKeywords.js';

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
});
