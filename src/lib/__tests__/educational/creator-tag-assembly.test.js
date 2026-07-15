/** @vitest-environment node */
/**
 * Integration test for the full creator serialization pipeline as run by
 * `createResource`/`updateResource`:
 *
 *   convertFormDataToAMB → ambToNostr → appendCreatorPTags
 *
 * Locks in the NIP-AMB rule that every creator has exactly ONE representation
 * on the wire: a `["p", pk, relay, "creator"]` tag when they have a Nostr
 * identity, a flattened `creator:*` run otherwise — never both. (A live event
 * carried both, so the resource page showed the same person twice.)
 */
import { describe, it, expect } from 'vitest';
import { ambToNostr } from 'amb-nostr-converter';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { appendCreatorPTags } from '$lib/helpers/educational/eventTags.js';

const AUTHOR_PK = 'f'.repeat(64);

const base = /** @type {any} */ ({
  name: 'Test Resource',
  description: 'desc',
  inLanguage: 'de',
  license: 'https://creativecommons.org/licenses/by/4.0/'
});

/**
 * Mirror of buildAMBEventTagsFromFormData + the appendCreatorPTags call in
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
  await appendCreatorPTags(tags, formData.creators, async () => 'wss://hint.example');
  return tags;
}

describe('creator tag assembly (NIP-AMB single representation)', () => {
  it('emits only a p-tag for a creator with a pubkey, only creator:* for one without', async () => {
    const tags = await assembleTags({
      ...base,
      creators: [
        { name: 'Corinna Link', type: 'Person' },
        { name: 'Colibri', type: 'Person', pubkey: AUTHOR_PK }
      ]
    });

    const creatorNames = tags.filter((t) => t[0] === 'creator:name').map((t) => t[1]);
    const pTags = tags.filter((t) => t[0] === 'p' && t[3] === 'creator');

    expect(creatorNames).toEqual(['Corinna Link']);
    expect(pTags).toEqual([['p', AUTHOR_PK, 'wss://hint.example', 'creator']]);
  });

  it('emits no creator:* run at all when the sole creator has a pubkey', async () => {
    const tags = await assembleTags({
      ...base,
      creators: [{ name: 'Colibri', type: 'Person', pubkey: AUTHOR_PK }]
    });

    expect(tags.some((t) => t[0].startsWith('creator:'))).toBe(false);
    expect(tags.filter((t) => t[0] === 'p' && t[3] === 'creator')).toHaveLength(1);
  });

  it('keeps a creator with an invalid pubkey in the creator:* run (no p-tag)', async () => {
    const tags = await assembleTags({
      ...base,
      creators: [{ name: 'Typo', type: 'Person', pubkey: 'not-a-key' }]
    });

    expect(tags.filter((t) => t[0] === 'creator:name').map((t) => t[1])).toEqual(['Typo']);
    expect(tags.some((t) => t[0] === 'p' && t[3] === 'creator')).toBe(false);
  });
});
