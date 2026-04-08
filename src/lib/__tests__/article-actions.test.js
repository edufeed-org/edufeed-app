/**
 * Article Actions Tests
 *
 * Tests for creating and updating NIP-23 long-form articles (kind 30023).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track signed events
/** @type {any} */
let lastSignedEvent = null;
/** @type {any} */
let _lastPublishCall = null;

// Mock dependencies
vi.mock('applesauce-core/event-factory', () => {
  class MockEventFactory {
    /** @param {any} template */
    async build(template) {
      return {
        ...template,
        created_at: 1700000000,
        pubkey: ''
      };
    }
  }
  return { EventFactory: MockEventFactory };
});

vi.mock('$lib/helpers/event-factory.js', async () => {
  const { EventFactory } = await import('applesauce-core/event-factory');
  return { createAppEventFactory: vi.fn(() => new EventFactory()) };
});

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: null
  }
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  encodeEventToNaddr: vi.fn(() => 'naddr1test')
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn((...args) => {
    _lastPublishCall = args;
  })
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => ['wss://longform.relay'])
}));

import { manager } from '$lib/stores/accounts.svelte';
import { createArticle, updateArticle } from '../stores/article-actions.svelte.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';

describe('createArticle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSignedEvent = null;
    _lastPublishCall = null;

    // Set up active user
    /** @type {any} */ (manager).active = {
      pubkey: 'abc123',
      signEvent: vi.fn(async (/** @type {any} */ template) => {
        lastSignedEvent = {
          ...template,
          id: 'event-id-123',
          pubkey: 'abc123',
          sig: 'sig123'
        };
        return lastSignedEvent;
      })
    };
  });

  it('builds correct NIP-23 tags', async () => {
    const result = await createArticle({
      title: 'My Article',
      content: '# Hello World',
      summary: 'A great article',
      image: 'https://example.com/cover.jpg',
      hashtags: ['nostr', 'writing']
    });

    expect(lastSignedEvent).toBeTruthy();
    const tags = lastSignedEvent.tags;

    // d-tag (random)
    const dTag = tags.find((/** @type {any} */ t) => t[0] === 'd');
    expect(dTag).toBeTruthy();
    expect(dTag[1]).toBeTruthy();

    // title
    expect(tags.find((/** @type {any} */ t) => t[0] === 'title')).toEqual(['title', 'My Article']);

    // published_at
    const pubAt = tags.find((/** @type {any} */ t) => t[0] === 'published_at');
    expect(pubAt).toBeTruthy();
    expect(Number(pubAt[1])).toBeGreaterThan(0);

    // summary
    expect(tags.find((/** @type {any} */ t) => t[0] === 'summary')).toEqual([
      'summary',
      'A great article'
    ]);

    // image
    expect(tags.find((/** @type {any} */ t) => t[0] === 'image')).toEqual([
      'image',
      'https://example.com/cover.jpg'
    ]);

    // hashtags
    const tTags = tags.filter((/** @type {any} */ t) => t[0] === 't');
    expect(tTags).toEqual([
      ['t', 'nostr'],
      ['t', 'writing']
    ]);

    // kind 30023
    expect(lastSignedEvent.kind).toBe(30023);

    // content is markdown body
    expect(lastSignedEvent.content).toBe('# Hello World');

    // returns naddr
    expect(result.naddr).toBe('naddr1test');
  });

  it('adds h-tag when community is specified', async () => {
    await createArticle({ title: 'Test', content: 'Body' }, 'community-pubkey-123');

    const hTag = lastSignedEvent.tags.find((/** @type {any} */ t) => t[0] === 'h');
    expect(hTag).toEqual(['h', 'community-pubkey-123']);
  });

  it('does not create kind 30222 targeted publication (removed in new spec)', async () => {
    /** @type {any} */
    const communityEvent = { id: 'ce1', kind: 10222, pubkey: 'community-pubkey-123' };
    await createArticle({ title: 'Test', content: 'Body' }, 'community-pubkey-123', communityEvent);

    // Only the content event should be published, no separate 30222 wrapper
    expect(publishEventOptimistic).toHaveBeenCalledTimes(1);
    expect(publishEventOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 30023 }),
      [],
      { communityEvent }
    );
  });

  it('validates required title', async () => {
    await expect(createArticle({ title: '', content: 'Body' })).rejects.toThrow(
      'Title is required'
    );
  });

  it('validates required content', async () => {
    await expect(createArticle({ title: 'Test', content: '' })).rejects.toThrow(
      'Article content is required'
    );
  });

  it('throws when not logged in', async () => {
    /** @type {any} */ (manager).active = null;
    await expect(createArticle({ title: 'Test', content: 'Body' })).rejects.toThrow(
      'No account selected'
    );
  });

  it('publishes optimistically', async () => {
    await createArticle({ title: 'Test', content: 'Body' });

    expect(publishEventOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-id-123' }),
      [],
      { communityEvent: null }
    );
  });

  it('encodes naddr with longform relays', async () => {
    await createArticle({ title: 'Test', content: 'Body' });

    expect(encodeEventToNaddr).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-id-123' }),
      ['wss://longform.relay']
    );
  });
});

describe('updateArticle', () => {
  const existingEvent = {
    id: 'existing-id',
    kind: 30023,
    pubkey: 'abc123',
    content: 'Old content',
    created_at: 1699000000,
    tags: [
      ['d', 'my-article-slug'],
      ['title', 'Old Title'],
      ['h', 'community-xyz']
    ],
    sig: 'sig-old'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastSignedEvent = null;

    /** @type {any} */ (manager).active = {
      pubkey: 'abc123',
      signEvent: vi.fn(async (/** @type {any} */ template) => {
        lastSignedEvent = {
          ...template,
          id: 'updated-id-456',
          pubkey: 'abc123',
          sig: 'sig456'
        };
        return lastSignedEvent;
      })
    };
  });

  it('preserves existing d-tag', async () => {
    await updateArticle({ title: 'New Title', content: 'New content' }, existingEvent);

    const dTag = lastSignedEvent.tags.find((/** @type {any} */ t) => t[0] === 'd');
    expect(dTag).toEqual(['d', 'my-article-slug']);
  });

  it('preserves existing h-tag', async () => {
    await updateArticle({ title: 'New Title', content: 'New content' }, existingEvent);

    const hTag = lastSignedEvent.tags.find((/** @type {any} */ t) => t[0] === 'h');
    expect(hTag).toEqual(['h', 'community-xyz']);
  });

  it('verifies ownership', async () => {
    const otherEvent = { ...existingEvent, pubkey: 'other-pubkey' };

    await expect(
      updateArticle({ title: 'New Title', content: 'New content' }, otherEvent)
    ).rejects.toThrow('you do not own this article');
  });

  it('validates required fields', async () => {
    await expect(updateArticle({ title: '', content: 'Body' }, existingEvent)).rejects.toThrow(
      'Title is required'
    );

    await expect(updateArticle({ title: 'Test', content: '' }, existingEvent)).rejects.toThrow(
      'Article content is required'
    );
  });

  it('requires d-tag on existing event', async () => {
    const noDTag = { ...existingEvent, tags: [['title', 'Old']] };

    await expect(updateArticle({ title: 'Test', content: 'Body' }, noDTag)).rejects.toThrow(
      'missing d-tag'
    );
  });
});
