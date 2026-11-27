/**
 * Hashtag (NIP-24 `t` tag) normalization used by the calendar event form.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { normalizeHashtag, normalizeHashtags, tagVariants } from '../helpers/hashtags.js';

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

describe('tagVariants', () => {
  // Relays match #t exactly; these spellings cover typed, lowercased (NIP-24
  // and our own old events) and capitalised tags.
  it('returns the tag as given, lowercase and capitalised, without duplicates', () => {
    expect(tagVariants('klimaWandel')).toEqual(['klimaWandel', 'klimawandel', 'Klimawandel']);
    expect(tagVariants('oer')).toEqual(['oer', 'Oer']);
    expect(tagVariants('Ökologie')).toEqual(['Ökologie', 'ökologie']);
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
