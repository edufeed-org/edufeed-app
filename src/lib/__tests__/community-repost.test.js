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
