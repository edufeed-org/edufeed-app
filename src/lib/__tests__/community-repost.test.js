/**
 * Tests for createCommunityRepost and createCommunityReposts helpers
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSign = vi.fn();
const mockShare = vi.fn();
const mockPublishEventOptimistic = vi.fn();

vi.mock('applesauce-core/event-factory', () => {
  /** @type {any} */
  const MockEventFactory = function () {
    this.share = mockShare;
    this.sign = mockSign;
  };
  return { EventFactory: MockEventFactory };
});

vi.mock('applesauce-common/blueprints', () => ({}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (/** @type {any[]} */ ...args) => mockPublishEventOptimistic(...args)
}));

import { createCommunityRepost, createCommunityReposts } from '$lib/helpers/communityRepost.js';

const fakeSigner = { sign: vi.fn() };

const fakeEvent = {
  id: 'event123',
  kind: 30023,
  pubkey: 'author-pubkey',
  created_at: 1000000,
  tags: [
    ['d', 'my-article'],
    ['title', 'Test Article']
  ],
  content: 'Hello world'
};

const fakeNonReplaceableEvent = {
  id: 'event456',
  kind: 1,
  pubkey: 'author-pubkey',
  created_at: 1000000,
  tags: [],
  content: 'A short note'
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createCommunityReposts (batch)', () => {
  it('creates a single repost with multiple h-tags for multiple communities', async () => {
    const template = {
      kind: 16,
      tags: [
        ['e', 'event123', ''],
        ['a', '30023:author-pubkey:my-article', ''],
        ['p', 'author-pubkey'],
        ['k', '30023']
      ],
      content: JSON.stringify(fakeEvent)
    };
    mockShare.mockResolvedValue(template);

    const signedEvent = { ...template, id: 'repost-id', sig: 'sig123' };
    mockSign.mockResolvedValue(signedEvent);

    const result = await createCommunityReposts(
      fakeEvent,
      ['comm-a', 'comm-b', 'comm-c'],
      fakeSigner
    );

    expect(result).toBe(true);

    // Only ONE sign call for all 3 communities
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledTimes(1);

    // Template should have all 3 h-tags
    const signedTemplate = mockSign.mock.calls[0][0];
    expect(signedTemplate.tags).toContainEqual(['h', 'comm-a']);
    expect(signedTemplate.tags).toContainEqual(['h', 'comm-b']);
    expect(signedTemplate.tags).toContainEqual(['h', 'comm-c']);

    // publishEventOptimistic called with signed event + community pubkeys
    expect(mockPublishEventOptimistic).toHaveBeenCalledWith(signedEvent, [
      'comm-a',
      'comm-b',
      'comm-c'
    ]);
  });

  it('clears content for replaceable events with a-tag', async () => {
    const template = {
      kind: 16,
      tags: [
        ['e', 'event123', ''],
        ['a', '30023:author-pubkey:my-article', ''],
        ['p', 'author-pubkey'],
        ['k', '30023']
      ],
      content: JSON.stringify(fakeEvent)
    };
    mockShare.mockResolvedValue(template);
    mockSign.mockResolvedValue({ ...template, id: 'x', sig: 'y' });

    await createCommunityReposts(fakeEvent, ['comm-a'], fakeSigner);

    const signedTemplate = mockSign.mock.calls[0][0];
    expect(signedTemplate.content).toBe('');
  });

  it('keeps content for non-replaceable events without a-tag', async () => {
    const template = {
      kind: 6,
      tags: [
        ['e', 'event456', ''],
        ['p', 'author-pubkey'],
        ['k', '1']
      ],
      content: JSON.stringify(fakeNonReplaceableEvent)
    };
    mockShare.mockResolvedValue(template);
    mockSign.mockResolvedValue({ ...template, id: 'x', sig: 'y' });

    await createCommunityReposts(fakeNonReplaceableEvent, ['comm-a'], fakeSigner);

    const signedTemplate = mockSign.mock.calls[0][0];
    expect(signedTemplate.content).toBe(JSON.stringify(fakeNonReplaceableEvent));
  });

  it('returns true immediately for empty community list', async () => {
    const result = await createCommunityReposts(fakeEvent, [], fakeSigner);

    expect(result).toBe(true);
    expect(mockShare).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
  });
});

describe('createCommunityRepost (single, backward compat)', () => {
  it('creates a NIP-18 repost with h-tag for community targeting', async () => {
    const template = {
      kind: 16,
      tags: [
        ['e', 'event123', ''],
        ['a', '30023:author-pubkey:my-article', ''],
        ['p', 'author-pubkey'],
        ['k', '30023']
      ],
      content: JSON.stringify(fakeEvent)
    };
    mockShare.mockResolvedValue(template);

    const signedEvent = {
      ...template,
      id: 'repost-id',
      pubkey: 'my-pubkey',
      created_at: 2000000,
      sig: 'sig123',
      tags: [...template.tags, ['h', 'community-pubkey-abc']]
    };
    mockSign.mockResolvedValue(signedEvent);

    const result = await createCommunityRepost(fakeEvent, 'community-pubkey-abc', fakeSigner);

    expect(result).toBe(true);
    expect(mockShare).toHaveBeenCalledWith(fakeEvent);
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockPublishEventOptimistic).toHaveBeenCalledWith(signedEvent, ['community-pubkey-abc']);
  });
});
