/** @vitest-environment node */
/**
 * Golden-output regression tests for the tag-assembly helpers extracted from
 * `educational-actions.svelte.js`. The assertions reproduce the exact tag
 * shapes that the pre-refactor inline code produced, so we can prove the
 * extraction preserves behavior byte-for-byte.
 */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { ambToNostr } from 'amb-nostr-converter';

import {
  appendCreatorPTags,
  appendExternalUrlTags,
  appendVariantLabelTags
} from '$lib/helpers/educational/eventTags.js';
import { buildResourceData } from '$lib/helpers/educational/buildResourceData.js';
import { convertFormDataToAMB } from '$lib/helpers/educational/formDataToAmb.js';
import { createInitialFormData } from '$lib/helpers/educational/wizardInitialState.js';

const AUTHOR_PK = 'f'.repeat(64);

/**
 * Mirror of `buildAMBEventTagsFromFormData` in `educational-actions.svelte.js`
 * (which can't be imported in node env — it's a Svelte-runes store module; see
 * `educational/creator-tag-assembly.test.js` for the established pattern).
 * @param {any} resourceData
 */
function assembleTags(resourceData) {
  const amb = convertFormDataToAMB(resourceData);
  const result = ambToNostr(/** @type {any} */ (amb), {
    pubkey: AUTHOR_PK,
    timestamp: 1_700_000_000
  });
  if (!result.success || !result.data) throw new Error('conversion failed');
  return result.data.tags;
}

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

/**
 * Publish-path coverage for the EKW/Konfi ext-namespace facets.
 *
 * This exercises the REAL flow — `buildResourceData` (the wizard's
 * submit-time whitelist) → `convertFormDataToAMB`/`ambToNostr` (what
 * `createResource`/`updateResource` call) — not the preview path
 * (`buildPreviewResource` reads raw formData directly and would mask a
 * `buildResourceData` forwarding gap) and not hand-crafted `resourceData`.
 *
 * Regression coverage: `buildResourceData` is a field whitelist. Before this
 * fix it forwarded raw EKW fields but only the pre-built `konfiTags` array
 * for Konfi — so `formDataToAmbExt`'s Konfi branch saw `undefined` and real
 * Konfi publishes emitted zero konfi facets (git.edufeed.org/edufeed/edufeed-app#46
 * class of bug, caught in the Task-4 review).
 */
describe('publish path — EKW/Konfi ext facets (via buildResourceData → convertFormDataToAMB)', () => {
  /** @returns {any} */
  function rawWizardFormData() {
    return {
      ...createInitialFormData(),
      name: 'Konfi-Einheit: Taufe',
      description: 'Eine Einheit zur Taufe',
      inLanguage: 'de',
      license: 'https://creativecommons.org/licenses/by/4.0/',
      bildungsbereich: 'konfi',
      // EKW facets (forwarded unconditionally by buildResourceData already).
      gradeLevels: ['https://edufeed.org/v/klassenstufen/5-6'],
      gradeLevelLabels: [{ id: 'https://edufeed.org/v/klassenstufen/5-6', label: '5–6' }],
      // Konfi facets — raw scheme-key fields as the KonfiStep4 UI sets them
      // on formData (see ResourceFormWizard.svelte's handleKonfiFieldChange).
      konfiZielgruppenIds: ['urn:ku3'],
      konfiZielgruppenLabels: [{ id: 'urn:ku3', label: 'KU3' }],
      plainLanguage: true
    };
  }

  it('carries both EKW and Konfi ext facets from raw formData through buildResourceData into the published tags', () => {
    const resourceData = buildResourceData(rawWizardFormData(), { about: [], hasNoUrl: true });
    const tags = assembleTags(resourceData);

    expect(tags).toContainEqual([
      'ext:ekw:gradeLevel:id',
      'https://edufeed.org/v/klassenstufen/5-6'
    ]);
    expect(tags).toContainEqual(['ext:org.edufeed.ekw.konfi:zielgruppen:id', 'urn:ku3']);
    expect(tags).toContainEqual(['ext:org.edufeed.ekw.konfi:plainLanguage', 'true']);
  });

  it('conforms to the legal ext:<ns>:<facet>[:sub] grammar — no illegal ext:ekw:konfi:* key', () => {
    const resourceData = buildResourceData(rawWizardFormData(), { about: [], hasNoUrl: true });
    const tags = assembleTags(resourceData);
    const extKeys = tags
      .map((/** @type {string[]} */ t) => t[0])
      .filter((k) => k.startsWith('ext:'));

    expect(extKeys.length).toBeGreaterThan(0);
    expect(extKeys.some((k) => k.startsWith('ext:ekw:konfi:'))).toBe(false);

    const LEGAL_SUB = /^(id|type|name|prefLabel:[^:]+)$/;
    for (const key of extKeys) {
      const segments = key.split(':');
      // ext:<ns>:<facet> at minimum; ns/facet must each be a single
      // colon-free segment, with an optional legal sub trailer.
      expect(segments[0]).toBe('ext');
      expect(segments.length).toBeGreaterThanOrEqual(3);
      const ns = segments[1];
      const facet = segments[2];
      const sub = segments.slice(3).join(':');
      expect(ns).not.toBe('');
      expect(ns.includes(':')).toBe(false);
      expect(facet).not.toBe('');
      expect(facet.includes(':')).toBe(false);
      if (sub !== '') expect(LEGAL_SUB.test(sub)).toBe(true);
    }
  });
});
