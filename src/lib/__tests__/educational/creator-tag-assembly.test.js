/** @vitest-environment node */
/**
 * Integration test for the full creator serialization pipeline as run by
 * `createResource`/`updateResource`:
 *
 *   convertFormDataToAMB → ambToNostr → appendFlattenedPeopleTags (linked
 *   people) → appendCreatorPTags
 *
 * Locks in the NIP-AMB rule: the flattened `creator:*` run is the credit; a
 * person with a Nostr identity carries it as `creator:id` = nostr:npub… plus
 * the companion `["p", pk, relay, "creator"]` tag. A linked person without a
 * real name stays a lone p tag.
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { ambToNostr } from 'amb-nostr-converter';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import {
  appendCreatorPTags,
  appendFlattenedPeopleTags,
  nostrCreditId
} from '$lib/helpers/educational/eventTags.js';
import {
  getAMBCreators,
  getAMBContributors,
  getRunPubkeys
} from '$lib/helpers/educational/ambHelpers.js';

const AUTHOR_PK = 'f'.repeat(64);
const AUTHOR_ID = `nostr:${nip19.npubEncode(AUTHOR_PK)}`;

const base = /** @type {any} */ ({
  name: 'Test Resource',
  description: 'desc',
  inLanguage: 'de',
  license: 'https://creativecommons.org/licenses/by/4.0/'
});

/**
 * Mirror of buildAMBEventTagsFromFormData (incl. its appendFlattenedPeopleTags
 * call for linked people) + the appendCreatorPTags call in
 * educational-actions.svelte.js (which can't be imported in node env — it's
 * a Svelte-runes store module).
 * @param {any} formData
 */
async function assembleTags(formData) {
  const amb = convertFormDataToAMB(formData);
  const result = ambToNostr(/** @type {any} */ (amb), {
    pubkey: AUTHOR_PK,
    timestamp: 1_700_000_000
  });
  if (!result.success || !result.data) throw new Error('conversion failed');
  const tags = result.data.tags;
  appendFlattenedPeopleTags(tags, (formData.creators || []).filter(nostrCreditId));
  await appendCreatorPTags(tags, formData.creators, async () => 'wss://hint.example');
  return tags;
}

describe('creator tag assembly (NIP-AMB run + companion p tag)', () => {
  it('writes run and p tag for a named creator with a pubkey, only creator:* for one without', async () => {
    const tags = await assembleTags({
      ...base,
      creators: [
        { name: 'Corinna Link', type: 'Person' },
        { name: 'Colibri', type: 'Person', pubkey: AUTHOR_PK }
      ]
    });

    expect(tags.filter((t) => t[0] === 'creator:name').map((t) => t[1])).toEqual([
      'Corinna Link',
      'Colibri'
    ]);
    expect(tags.filter((t) => t[0] === 'creator:id')).toEqual([['creator:id', AUTHOR_ID]]);
    expect(tags.filter((t) => t[0] === 'p')).toEqual([
      ['p', AUTHOR_PK, 'wss://hint.example', 'creator']
    ]);
  });

  it('one id per person: the ORCID is not written when a pubkey is set', async () => {
    const tags = await assembleTags({
      ...base,
      creators: [
        {
          name: 'Colibri',
          type: 'Person',
          pubkey: AUTHOR_PK,
          orcid: 'https://orcid.org/0000-0002-1825-0097'
        }
      ]
    });
    expect(tags.filter((t) => t[0] === 'creator:id')).toEqual([['creator:id', AUTHOR_ID]]);
  });

  // CreatorInput stores `<first 8 hex chars>…` as the list name of a linked
  // person without a resolvable profile — never a credited name.
  it('keeps a linked creator without a real name a lone p tag', async () => {
    for (const name of ['', '   ', 'ffffffff…']) {
      const tags = await assembleTags({
        ...base,
        creators: [{ name, type: 'Person', pubkey: AUTHOR_PK }]
      });
      expect(tags.some((t) => t[0].startsWith('creator:'))).toBe(false);
      expect(tags.filter((t) => t[0] === 'p')).toEqual([
        ['p', AUTHOR_PK, 'wss://hint.example', 'creator']
      ]);
    }
  });

  it('keeps a creator with an invalid pubkey in the creator:* run (no p-tag)', async () => {
    const tags = await assembleTags({
      ...base,
      creators: [{ name: 'Typo', type: 'Person', pubkey: 'not-a-key' }]
    });

    expect(tags.filter((t) => t[0] === 'creator:name').map((t) => t[1])).toEqual(['Typo']);
    expect(tags.some((t) => t[0] === 'creator:id')).toBe(false);
    expect(tags.some((t) => t[0] === 'p' && t[3] === 'creator')).toBe(false);
  });

  it('round-trips: form → tags → one person with name and pubkey', async () => {
    const CONTRIB_PK = 'e'.repeat(64);
    const tags = await assembleTags({
      ...base,
      creators: [
        { name: 'Erika Mustermann', type: 'Person', honorificPrefix: 'Dr.' },
        { name: 'Colibri', type: 'Person', pubkey: AUTHOR_PK, affiliationName: 'PTI' },
        { name: 'Helper', type: 'Person', pubkey: CONTRIB_PK, role: 'contributor' },
        { name: 'Gina', type: 'Person', role: 'contributor' }
      ]
    });
    const event = /** @type {any} */ ({ kind: 30142, tags });

    expect(getAMBCreators(event)).toEqual([
      { name: 'Erika Mustermann', type: 'Person', honorificPrefix: 'Dr.' },
      { name: 'Colibri', type: 'Person', affiliationName: 'PTI', id: AUTHOR_ID, pubkey: AUTHOR_PK }
    ]);
    expect(getAMBContributors(event)).toEqual([
      { name: 'Gina', type: 'Person' },
      {
        name: 'Helper',
        type: 'Person',
        id: `nostr:${nip19.npubEncode(CONTRIB_PK)}`,
        pubkey: CONTRIB_PK
      }
    ]);
    expect(tags.filter((t) => t[0] === 'p')).toEqual([
      ['p', AUTHOR_PK, 'wss://hint.example', 'creator'],
      ['p', CONTRIB_PK, 'wss://hint.example', 'contributor']
    ]);
    // every p tag is the companion of a run
    expect([...getRunPubkeys(event, 'creator')]).toEqual([AUTHOR_PK]);
    expect([...getRunPubkeys(event, 'contributor')]).toEqual([CONTRIB_PK]);
  });
});
