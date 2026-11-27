/**
 * Hashtag (NIP-24 `t` tag) normalization used by the calendar event form.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { normalizeHashtag, normalizeHashtags } from '../helpers/hashtags.js';

describe('normalizeHashtag', () => {
  it('trims and strips leading # but keeps the case as typed', () => {
    expect(normalizeHashtag('  #OER ')).toBe('OER');
    expect(normalizeHashtag('##Nostr')).toBe('Nostr');
    expect(normalizeHashtag('schule')).toBe('schule');
  });

  it('keeps inner characters, including umlauts', () => {
    expect(normalizeHashtag('Fortbildung-Ä')).toBe('Fortbildung-Ä');
  });

  it('returns an empty string for blank or #-only input', () => {
    expect(normalizeHashtag('   ')).toBe('');
    expect(normalizeHashtag('#')).toBe('');
    expect(normalizeHashtag(/** @type {any} */ (undefined))).toBe('');
  });
});

describe('normalizeHashtags', () => {
  it('drops empties and dedupes case-insensitively, first spelling wins', () => {
    expect(normalizeHashtags(['OER', ' ', '#oer', 'nostr', '', 'Nostr', 'kalender'])).toEqual([
      'OER',
      'nostr',
      'kalender'
    ]);
  });

  it('handles null/undefined and non-string entries', () => {
    expect(normalizeHashtags(undefined)).toEqual([]);
    expect(normalizeHashtags(null)).toEqual([]);
    expect(normalizeHashtags(/** @type {any} */ (['a', 42, null]))).toEqual(['a']);
  });
});
