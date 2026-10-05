/**
 * Hashtag (NIP-24 `t` tag) normalization used by the calendar event form.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { normalizeHashtag, normalizeHashtags } from '../helpers/hashtags.js';

describe('normalizeHashtag', () => {
  it('trims, strips leading # and lowercases (NIP-24: t tags SHOULD be lowercase)', () => {
    expect(normalizeHashtag('  #OER ')).toBe('oer');
    expect(normalizeHashtag('##Nostr')).toBe('nostr');
    expect(normalizeHashtag('Schule')).toBe('schule');
  });

  it('keeps inner characters, including umlauts', () => {
    expect(normalizeHashtag('Fortbildung-Ä')).toBe('fortbildung-ä');
  });

  it('returns an empty string for blank or #-only input', () => {
    expect(normalizeHashtag('   ')).toBe('');
    expect(normalizeHashtag('#')).toBe('');
    expect(normalizeHashtag(/** @type {any} */ (undefined))).toBe('');
  });
});

describe('normalizeHashtags', () => {
  it('normalizes, drops empties and dedupes preserving first-seen order', () => {
    expect(normalizeHashtags(['OER', ' ', '#oer', 'nostr', '', 'Nostr', 'kalender'])).toEqual([
      'oer',
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
