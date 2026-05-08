// @ts-nocheck
/**
 * Keyword-input helper tests
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { splitKeywordInput, mergeKeywords } from '$lib/helpers/educational/keywordInput.js';

describe('splitKeywordInput', () => {
  it('returns empty array for empty or whitespace-only input', () => {
    expect(splitKeywordInput('')).toEqual([]);
    expect(splitKeywordInput('   ')).toEqual([]);
    expect(splitKeywordInput(',,')).toEqual([]);
  });

  it('returns a single token for a plain trimmed value', () => {
    expect(splitKeywordInput('  mathematics  ')).toEqual(['mathematics']);
  });

  it('splits comma-separated input and trims each token', () => {
    expect(splitKeywordInput('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('splits newline-separated input (paste from a list)', () => {
    expect(splitKeywordInput('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('handles mixed separators and extra whitespace', () => {
    expect(splitKeywordInput('a, b\nc,\n,d')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('mergeKeywords', () => {
  it('appends new tokens to the existing list', () => {
    expect(mergeKeywords(['a'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('skips duplicates already in the list', () => {
    expect(mergeKeywords(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('skips duplicates within the additions list', () => {
    expect(mergeKeywords([], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('preserves insertion order', () => {
    expect(mergeKeywords(['x'], ['a', 'b', 'x', 'c'])).toEqual(['x', 'a', 'b', 'c']);
  });
});
