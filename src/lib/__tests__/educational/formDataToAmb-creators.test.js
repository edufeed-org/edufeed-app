/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
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

  // NIP-AMB: a creator is represented EITHER by a `["p", pk, relay, "creator"]`
  // tag (Nostr identity, name resolved from kind:0) OR by a flattened
  // creator:* run — never both. Creators with a valid pubkey therefore must
  // not appear in the AMB creator array (the p-tag appended later by
  // appendCreatorPTags is their sole representation).
  it('excludes creators with a valid hex pubkey from amb.creator', () => {
    const amb = convertFormDataToAMB({
      ...base,
      creators: [
        { name: 'Corinna Link', type: 'Person' },
        { name: 'Colibri', type: 'Person', pubkey: 'f'.repeat(64) }
      ]
    });
    expect(amb.creator).toEqual([{ type: 'Person', name: 'Corinna Link' }]);
  });

  it('excludes creators with an npub pubkey from amb.creator', () => {
    const npub = nip19.npubEncode('a'.repeat(64));
    const amb = convertFormDataToAMB({
      ...base,
      creators: [{ name: 'Alice', type: 'Person', pubkey: npub }]
    });
    expect(amb.creator).toBeUndefined();
  });

  it('omits the creator field entirely when all creators have pubkeys', () => {
    const amb = convertFormDataToAMB({
      ...base,
      creators: [
        { name: 'Alice', type: 'Person', pubkey: 'a'.repeat(64) },
        { name: 'Bob', type: 'Person', pubkey: 'b'.repeat(64) }
      ]
    });
    expect(amb.creator).toBeUndefined();
  });

  it('keeps creators whose pubkey does not normalize (they get no p-tag)', () => {
    // appendCreatorPTags drops invalid pubkeys (nsec, typos); without the
    // flattened run the person would vanish from the event entirely.
    const amb = convertFormDataToAMB({
      ...base,
      creators: [{ name: 'Typo', type: 'Person', pubkey: 'not-a-key' }]
    });
    expect(amb.creator).toEqual([{ type: 'Person', name: 'Typo' }]);
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
