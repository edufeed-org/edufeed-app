/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';

/** Minimal form-data shell so the helper doesn't crash on missing fields. */
const base = /** @type {any} */ ({
  name: 'Test Resource',
  description: 'desc',
  inLanguage: 'de',
  license: 'https://creativecommons.org/licenses/by/4.0/'
});

describe('convertFormDataToAMB creators', () => {
  it('maps creator orcid to AMB creator.id', () => {
    const amb = convertFormDataToAMB({
      ...base,
      creators: [
        {
          name: 'Ada Lovelace',
          type: 'Person',
          orcid: 'https://orcid.org/0000-0002-1825-0097'
        }
      ]
    });
    expect(amb.creator).toEqual([
      {
        type: 'Person',
        name: 'Ada Lovelace',
        id: 'https://orcid.org/0000-0002-1825-0097'
      }
    ]);
  });

  it('omits id when creator has no orcid', () => {
    const amb = convertFormDataToAMB({
      ...base,
      creators: [{ name: 'No Orcid', type: 'Person' }]
    });
    expect(amb.creator[0].id).toBeUndefined();
  });

  it('keeps honorificPrefix and affiliation alongside orcid', () => {
    const amb = convertFormDataToAMB({
      ...base,
      creators: [
        {
          name: 'Grace Hopper',
          type: 'Person',
          honorificPrefix: 'Dr.',
          affiliationName: 'Navy',
          orcid: 'https://orcid.org/0000-0002-1694-233X'
        }
      ]
    });
    expect(amb.creator[0]).toEqual({
      type: 'Person',
      name: 'Grace Hopper',
      honorificPrefix: 'Dr.',
      affiliation: { name: 'Navy' },
      id: 'https://orcid.org/0000-0002-1694-233X'
    });
  });
});
