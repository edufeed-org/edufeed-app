/**
 * Tests for createCommunityRepost and createCommunityReposts helpers
 *
 * Runs the REAL applesauce v6 ShareFactory (and the app's finalizeDraft
 * wrapper); only the publish service is mocked, so the produced repost
 * template (kind, e/a tags, content) is asserted for real.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPublishEventOptimistic = vi.fn();

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (/** @type {any[]} */ ...args) => mockPublishEventOptimistic(...args)
}));

import { createCommunityRepost, createCommunityReposts } from '$lib/helpers/communityRepost.js';

/** @type {any} */
let lastSignedEvent = null;
const fakeSigner = {
  signEvent: vi.fn(async (/** @type {any} */ template) => {
    lastSignedEvent = { ...template, id: 'repost-id', pubkey: 'my-pubkey', sig: 'sig123' };
    return lastSignedEvent;
  })
};

const fakeEvent = {
  id: 'event123',
  kind: 30023,
  pubkey: 'author-pubkey',
  created_at: 1000000,
  tags: [
    ['d', 'my-article'],
    ['title', 'Test Article']
  ],
  content: 'Hello world',
  sig: 'author-sig'
};

const fakeNonReplaceableEvent = {
  id: 'event456',
  kind: 1,
  pubkey: 'author-pubkey',
  created_at: 1000000,
  tags: [],
  content: 'A short note',
  sig: 'author-sig'
};

beforeEach(() => {
  vi.clearAllMocks();
  lastSignedEvent = null;
});

describe('createCommunityReposts (batch)', () => {
  it('creates a single repost with multiple h-tags for multiple communities', async () => {
    const result = await createCommunityReposts(
      fakeEvent,
      ['comm-a', 'comm-b', 'comm-c'],
      fakeSigner
    );

    expect(result).toBe(true);

    // Only ONE sign call for all 3 communities
    expect(fakeSigner.signEvent).toHaveBeenCalledTimes(1);

    // Template should be a kind 16 generic repost referencing the article
    const signedTemplate = fakeSigner.signEvent.mock.calls[0][0];
    expect(signedTemplate.kind).toBe(16);
    expect(signedTemplate.tags.some((/** @type {string[]} */ t) => t[0] === 'e')).toBe(true);
    expect(
      signedTemplate.tags.some(
        (/** @type {string[]} */ t) => t[0] === 'a' && t[1] === '30023:author-pubkey:my-article'
      )
    ).toBe(true);

    // Template should have all 3 h-tags
    expect(signedTemplate.tags).toContainEqual(['h', 'comm-a']);
    expect(signedTemplate.tags).toContainEqual(['h', 'comm-b']);
    expect(signedTemplate.tags).toContainEqual(['h', 'comm-c']);

    // publishEventOptimistic called with signed event + community pubkeys
    // (+ discoverability relays, see repostTargetRelays)
    expect(mockPublishEventOptimistic).toHaveBeenCalledWith(
      lastSignedEvent,
      ['comm-a', 'comm-b', 'comm-c'],
      expect.objectContaining({ additionalRelays: expect.any(Array) })
    );
  });

  it('clears content for replaceable events with a-tag', async () => {
    await createCommunityReposts(fakeEvent, ['comm-a'], fakeSigner);

    const signedTemplate = fakeSigner.signEvent.mock.calls[0][0];
    expect(signedTemplate.content).toBe('');
  });

  it('keeps content for non-replaceable events without a-tag', async () => {
    await createCommunityReposts(fakeNonReplaceableEvent, ['comm-a'], fakeSigner);

    const signedTemplate = fakeSigner.signEvent.mock.calls[0][0];
    expect(signedTemplate.tags.some((/** @type {string[]} */ t) => t[0] === 'a')).toBe(false);
    expect(JSON.parse(signedTemplate.content)).toMatchObject({
      id: 'event456',
      kind: 1,
      content: 'A short note'
    });
  });

  it('returns true immediately for empty community list', async () => {
    const result = await createCommunityReposts(fakeEvent, [], fakeSigner);

    expect(result).toBe(true);
    expect(fakeSigner.signEvent).not.toHaveBeenCalled();
    expect(mockPublishEventOptimistic).not.toHaveBeenCalled();
  });
});

describe('createCommunityRepost (single, backward compat)', () => {
  it('creates a NIP-18 repost with h-tag for community targeting', async () => {
    const result = await createCommunityRepost(fakeEvent, 'community-pubkey-abc', fakeSigner);

    expect(result).toBe(true);
    expect(fakeSigner.signEvent).toHaveBeenCalledTimes(1);

    const signedTemplate = fakeSigner.signEvent.mock.calls[0][0];
    expect(signedTemplate.tags).toContainEqual(['h', 'community-pubkey-abc']);

    expect(mockPublishEventOptimistic).toHaveBeenCalledWith(
      lastSignedEvent,
      ['community-pubkey-abc'],
      expect.objectContaining({ additionalRelays: expect.any(Array) })
    );
  });
});

/**
 * A share of a DELETED event is a dangling pointer: the repost publishes fine,
 * but no other user can resolve the target, so the content simply never
 * appears for them. That is exactly what happened — a resource its author had
 * deleted 17 days earlier was still sitting in the sharer's local eventStore,
 * so the picker offered it and the share silently went nowhere (laoc,
 * 2026-08-24).
 */
describe('sharing a deleted event', () => {
  const AUTHOR = '65a652cbd6e2717da31f214ff417993260bc972136752ba1ab53dd3af5a21b02';
  const deletedResource = {
    id: 'bdaec4c05420d3e7230734cf7739e32d7a824eaa44a25bcbdb67ce70df5afb1a',
    kind: 30142,
    pubkey: AUTHOR,
    created_at: 1780000000,
    tags: [['d', 'https://phaidra.kphvie.ac.at/o:4192']],
    content: '',
    sig: 'author-sig'
  };

  it('refuses the share and signs nothing', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte.js');
    eventStore.add({
      kind: 5,
      id: 'd'.repeat(64),
      pubkey: AUTHOR,
      created_at: 1786098496,
      content: '',
      sig: 'deletion-sig',
      tags: [
        ['k', '30142'],
        ['e', deletedResource.id],
        ['a', `30142:${AUTHOR}:https://phaidra.kphvie.ac.at/o:4192`]
      ]
    });

    const result = await createCommunityReposts(deletedResource, ['community-abc'], fakeSigner);

    expect(result).toBe(false);
    expect(fakeSigner.signEvent).not.toHaveBeenCalled();
    expect(mockPublishEventOptimistic).not.toHaveBeenCalled();
  });

  // The author's OTHER resources are untouched — a deletion names one address.
  //
  // Built as a fresh literal, NOT `{...deletedResource, tags: [...]}`: the
  // deletion check memoises `Symbol(replaceable-identifier)` onto the event it
  // inspects, and an object spread copies own symbols — so a sibling spread
  // from a checked event inherits the ORIGINAL's address and is judged deleted.
  // Measured, not reasoned about. Same family as the applesauce memoisation
  // hazards in CLAUDE.md.
  it('still shares a sibling the same author did not delete', async () => {
    const sibling = {
      id: 'f'.repeat(64),
      kind: 30142,
      pubkey: AUTHOR,
      created_at: 1780000000,
      tags: [['d', 'https://phaidra.kphvie.ac.at/o:4202']],
      content: '',
      sig: 'author-sig'
    };

    const result = await createCommunityReposts(sibling, ['community-abc'], fakeSigner);

    expect(result).toBe(true);
    expect(fakeSigner.signEvent).toHaveBeenCalledTimes(1);
  });
});
