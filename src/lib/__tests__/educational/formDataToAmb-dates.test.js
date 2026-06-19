/**
 * `convertFormDataToAMB` — date fields (datePublished / dateCreated).
 *
 * AMB/LRMI (schema.org) defines dateCreated, datePublished, dateModified.
 * The metadata form must capture at least datePublished and emit it as a tag
 * so the relay can index it. This file pins that the form's date fields flow
 * through to the AMB object and onward to a `["datePublished", ...]` /
 * `["dateCreated", ...]` Nostr tag. Empty/absent dates must NOT appear.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/helpers/educational/skosLoader.js', () => ({
  extractLabelFromUri: (/** @type {string} */ uri) => uri
}));

import { ambToNostr } from 'amb-nostr-converter';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { getAMBDatePublished, getAMBDateCreated } from '$lib/helpers/educational/ambHelpers.js';

/** Minimal form-data shell so the helper doesn't crash on missing fields. */
const BASE = /** @type {any} */ ({
  name: 'Test',
  description: 'Desc',
  slug: 'test-slug',
  inLanguage: 'de',
  license: 'https://creativecommons.org/licenses/by/4.0/'
});

describe('convertFormDataToAMB — datePublished / dateCreated', () => {
  it('maps datePublished and dateCreated onto the AMB object', () => {
    const amb = convertFormDataToAMB({
      ...BASE,
      datePublished: '2018-05-03',
      dateCreated: '2018-01-10'
    });
    expect(amb.datePublished).toBe('2018-05-03');
    expect(amb.dateCreated).toBe('2018-01-10');
  });

  it('omits date fields when blank or absent', () => {
    const amb = convertFormDataToAMB({ ...BASE, datePublished: '', dateCreated: '   ' });
    expect(amb.datePublished).toBeUndefined();
    expect(amb.dateCreated).toBeUndefined();
  });

  it('trims surrounding whitespace before mapping', () => {
    const amb = convertFormDataToAMB({ ...BASE, datePublished: '  2018-05-03  ' });
    expect(amb.datePublished).toBe('2018-05-03');
  });

  it('ambToNostr emits datePublished and dateCreated tags from the mapped AMB', () => {
    const amb = convertFormDataToAMB({
      ...BASE,
      datePublished: '2018-05-03',
      dateCreated: '2018-01-10'
    });
    const result = ambToNostr(/** @type {any} */ (amb), {
      pubkey: '0'.repeat(64),
      timestamp: 1_700_000_000
    });
    expect(result.success, `ambToNostr failed: ${result.error?.message}`).toBe(true);
    const tags = result.data?.tags ?? [];
    expect(tags).toContainEqual(['datePublished', '2018-05-03']);
    expect(tags).toContainEqual(['dateCreated', '2018-01-10']);
  });
});

describe('getAMBDatePublished / getAMBDateCreated', () => {
  it('reads the raw tag value back', () => {
    const event = {
      created_at: 1_700_000_000,
      tags: [
        ['datePublished', '2018-05-03'],
        ['dateCreated', '2018-01-10']
      ]
    };
    expect(getAMBDatePublished(event)).toBe('2018-05-03');
    expect(getAMBDateCreated(event)).toBe('2018-01-10');
  });

  it('returns empty string when the tag is absent (no created_at fallback)', () => {
    const event = { created_at: 1_700_000_000, tags: [] };
    expect(getAMBDatePublished(event)).toBe('');
    expect(getAMBDateCreated(event)).toBe('');
  });
});
