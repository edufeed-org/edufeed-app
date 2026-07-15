/** @vitest-environment node */
/**
 * Golden-output regression tests for the tag-assembly helpers extracted from
 * `educational-actions.svelte.js`. The assertions reproduce the exact tag
 * shapes that the pre-refactor inline code produced, so we can prove the
 * extraction preserves behavior byte-for-byte.
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';

import {
  appendCreatorPTags,
  appendExternalUrlTags,
  appendVariantLabelTags
} from '$lib/helpers/educational/eventTags.js';

describe('appendVariantLabelTags', () => {
  it('pushes NIP-32 namespace tag and value tag in order', () => {
    /** @type {string[][]} */
    const tags = [];
    appendVariantLabelTags(tags, 'amb');
    expect(tags).toEqual([
      ['L', 'metadata-form'],
      ['l', 'amb', 'metadata-form']
    ]);
  });

  it('uses the provided variantId verbatim', () => {
    /** @type {string[][]} */
    const tags = [];
    appendVariantLabelTags(tags, 'ekw');
    expect(tags).toEqual([
      ['L', 'metadata-form'],
      ['l', 'ekw', 'metadata-form']
    ]);
  });

  it('appends to an existing tag array without clobbering prior entries', () => {
    /** @type {string[][]} */
    const tags = [['d', 'some-slug']];
    appendVariantLabelTags(tags, 'amb');
    expect(tags).toEqual([
      ['d', 'some-slug'],
      ['L', 'metadata-form'],
      ['l', 'amb', 'metadata-form']
    ]);
  });
});

describe('appendExternalUrlTags', () => {
  it('pushes one r-tag per non-empty URL (matches pre-refactor inline logic)', () => {
    /** @type {string[][]} */
    const tags = [];
    appendExternalUrlTags(tags, ['https://example.com', 'https://foo.bar/baz']);
    expect(tags).toEqual([
      ['r', 'https://example.com'],
      ['r', 'https://foo.bar/baz']
    ]);
  });

  it('trims whitespace and skips empty/whitespace-only entries', () => {
    /** @type {string[][]} */
    const tags = [];
    appendExternalUrlTags(tags, ['  https://a.example  ', '', '   ', 'https://b.example']);
    expect(tags).toEqual([
      ['r', 'https://a.example'],
      ['r', 'https://b.example']
    ]);
  });

  it('is a no-op when urls is undefined or empty', () => {
    /** @type {string[][]} */
    const tags = [];
    appendExternalUrlTags(tags, undefined);
    appendExternalUrlTags(tags, []);
    expect(tags).toEqual([]);
  });
});

describe('appendCreatorPTags', () => {
  const ALICE_HEX = 'a'.repeat(64);
  const BOB_HEX = 'b'.repeat(64);

  it('pushes p-tag with relay hint + "creator" marker for each creator with a pubkey', async () => {
    /** @type {string[][]} */
    const tags = [];
    /** @type {(pubkey: string) => Promise<string>} */
    const resolve = async (pubkey) => `wss://hint.example/${pubkey.slice(0, 4)}`;
    await appendCreatorPTags(
      tags,
      [
        { name: 'Alice', type: 'Person', pubkey: ALICE_HEX },
        { name: 'Bob', type: 'Person', pubkey: BOB_HEX }
      ],
      resolve
    );
    expect(tags).toEqual([
      ['p', ALICE_HEX, 'wss://hint.example/aaaa', 'creator'],
      ['p', BOB_HEX, 'wss://hint.example/bbbb', 'creator']
    ]);
  });

  it('skips creators without a pubkey', async () => {
    /** @type {string[][]} */
    const tags = [];
    await appendCreatorPTags(
      tags,
      [
        { name: 'No-Nostr Author', type: 'Person' },
        { name: 'Alice', type: 'Person', pubkey: ALICE_HEX }
      ],
      async () => 'wss://hint'
    );
    expect(tags).toEqual([['p', ALICE_HEX, 'wss://hint', 'creator']]);
  });

  it('is a no-op when creators is undefined or empty', async () => {
    /** @type {string[][]} */
    const tags = [];
    await appendCreatorPTags(tags, undefined, async () => 'wss://hint');
    await appendCreatorPTags(tags, [], async () => 'wss://hint');
    expect(tags).toEqual([]);
  });

  it('never publishes an nsec — creators with a private key as pubkey are dropped', async () => {
    // Regression: a user pasted their nsec into the creator field and it was
    // published verbatim inside a p-tag, leaking the private key on relays.
    /** @type {string[][]} */
    const tags = [];
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));
    await appendCreatorPTags(
      tags,
      [
        { name: 'Leaky', type: 'Person', pubkey: nsec },
        { name: 'Alice', type: 'Person', pubkey: ALICE_HEX }
      ],
      async () => 'wss://hint'
    );
    expect(tags).toEqual([['p', ALICE_HEX, 'wss://hint', 'creator']]);
  });

  it('normalizes an npub pubkey to hex before tagging', async () => {
    /** @type {string[][]} */
    const tags = [];
    const npub = nip19.npubEncode(ALICE_HEX);
    await appendCreatorPTags(
      tags,
      [{ name: 'Alice', type: 'Person', pubkey: npub }],
      async () => 'wss://hint'
    );
    expect(tags).toEqual([['p', ALICE_HEX, 'wss://hint', 'creator']]);
  });

  it('drops creators whose pubkey is arbitrary garbage', async () => {
    /** @type {string[][]} */
    const tags = [];
    await appendCreatorPTags(
      tags,
      [{ name: 'Typo', type: 'Person', pubkey: 'not-a-key' }],
      async () => 'wss://hint'
    );
    expect(tags).toEqual([]);
  });
});
