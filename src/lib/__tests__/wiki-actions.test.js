/**
 * Wiki Actions Tests
 *
 * Tests createWiki and updateWiki functions.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: null
  }
}));

// The real $lib/helpers/event-factory.js wrapper runs (no mock needed on v6).
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  encodeEventToNaddr: vi.fn().mockReturnValue('naddr1test')
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn()
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn().mockReturnValue(['wss://relay.example.com'])
}));

const { createWiki, updateWiki } = await import('$lib/stores/wiki-actions.svelte.js');
const { manager } = await import('$lib/stores/accounts.svelte');
const { publishEventOptimistic } = await import('$lib/services/publish-service.js');

/** @type {any} */
let lastSignedEvent = null;

describe('createWiki', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastSignedEvent = null;
    /** @type {any} */ (manager).active = {
      pubkey: 'testpubkey123',
      signEvent: vi.fn(async (/** @type {any} */ event) => {
        lastSignedEvent = {
          ...event,
          id: 'signed-event-id',
          sig: 'test-sig',
          pubkey: 'testpubkey123'
        };
        return lastSignedEvent;
      })
    };
  });

  it('throws when no account is active', async () => {
    /** @type {any} */ (manager).active = null;

    await expect(createWiki({ title: 'Test', content: 'Content', topic: 'test' })).rejects.toThrow(
      'No account selected'
    );
  });

  it('throws when title is missing', async () => {
    await expect(createWiki({ title: '', content: 'Content', topic: 'test' })).rejects.toThrow(
      'Title is required'
    );
  });

  it('throws when content is missing', async () => {
    await expect(createWiki({ title: 'Test', content: '', topic: 'test' })).rejects.toThrow(
      'Wiki content is required'
    );
  });

  it('throws when topic is missing', async () => {
    await expect(createWiki({ title: 'Test', content: 'Content', topic: '' })).rejects.toThrow(
      'Topic is required'
    );
  });

  it('creates a wiki event with correct kind and tags', async () => {
    const result = await createWiki({
      title: 'Test Wiki',
      content: '# Hello',
      topic: 'My Topic',
      summary: 'A summary',
      hashtags: ['test', 'wiki']
    });

    expect(result.naddr).toBe('naddr1test');
    expect(publishEventOptimistic).toHaveBeenCalledOnce();

    expect(lastSignedEvent).toBeTruthy();
    expect(lastSignedEvent.kind).toBe(30818);
    expect(lastSignedEvent.content).toBe('# Hello');

    // Check tags
    const tags = lastSignedEvent.tags;
    expect(tags.find((/** @type {any} */ t) => t[0] === 'd')).toBeTruthy();
    expect(tags.find((/** @type {any} */ t) => t[0] === 'title')?.[1]).toBe('Test Wiki');
    expect(tags.find((/** @type {any} */ t) => t[0] === 'summary')?.[1]).toBe('A summary');
    expect(tags.filter((/** @type {any} */ t) => t[0] === 't')).toHaveLength(2);
  });

  it('normalizes topic for d-tag', async () => {
    await createWiki({
      title: 'Test',
      content: 'Content',
      topic: 'My Topic'
    });

    expect(lastSignedEvent).toBeTruthy();
    const dTag = lastSignedEvent.tags.find((/** @type {any} */ t) => t[0] === 'd')?.[1];
    // normalizeIdentifier lowercases and replaces spaces with hyphens
    expect(dTag).toBe('my-topic');
  });

  it('adds h-tag when communityPubkey provided', async () => {
    await createWiki({ title: 'Test', content: 'Content', topic: 'test' }, 'community123');

    expect(lastSignedEvent).toBeTruthy();
    const hTag = lastSignedEvent.tags.find((/** @type {any} */ t) => t[0] === 'h');
    expect(hTag?.[1]).toBe('community123');
  });

  it('does not create kind 30222 targeted publication (removed in new spec)', async () => {
    await createWiki({ title: 'Test', content: 'Content', topic: 'test' }, 'community123');

    // Only the content event should be published, no separate 30222 wrapper
    expect(publishEventOptimistic).toHaveBeenCalledTimes(1);
  });
});

describe('updateWiki', () => {
  /** @type {any} */
  const existingEvent = {
    id: 'existing-id',
    kind: 30818,
    pubkey: 'testpubkey123',
    tags: [
      ['d', 'existing-topic'],
      ['title', 'Old Title'],
      ['h', 'community123']
    ],
    content: 'Old content',
    created_at: 1000000,
    sig: 'existing-sig'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastSignedEvent = null;
    /** @type {any} */ (manager).active = {
      pubkey: 'testpubkey123',
      signEvent: vi.fn(async (/** @type {any} */ event) => {
        lastSignedEvent = {
          ...event,
          id: 'updated-event-id',
          sig: 'test-sig',
          pubkey: 'testpubkey123'
        };
        return lastSignedEvent;
      })
    };
  });

  it('throws when user does not own the wiki', async () => {
    /** @type {any} */ (manager).active = { pubkey: 'otherpubkey', signEvent: vi.fn() };

    await expect(
      updateWiki({ title: 'New', content: 'New', topic: 'test' }, existingEvent)
    ).rejects.toThrow('you do not own');
  });

  it('preserves existing d-tag', async () => {
    await updateWiki({ title: 'Updated', content: 'New content', topic: 'ignored' }, existingEvent);

    expect(lastSignedEvent).toBeTruthy();
    const dTag = lastSignedEvent.tags.find((/** @type {any} */ t) => t[0] === 'd')?.[1];
    expect(dTag).toBe('existing-topic');
  });

  it('preserves existing h-tag', async () => {
    await updateWiki({ title: 'Updated', content: 'New content', topic: 'test' }, existingEvent);

    expect(lastSignedEvent).toBeTruthy();
    const hTag = lastSignedEvent.tags.find((/** @type {any} */ t) => t[0] === 'h')?.[1];
    expect(hTag).toBe('community123');
  });

  it('stamps created_at strictly newer than the version it replaces (#64)', async () => {
    // A same-second edit ties, and on a tie nostr-idb keeps the OLD version
    // deterministically — the cache then serves it without asking a relay.
    // Same bug as the calendar edit path in #62.
    const future = { ...existingEvent, created_at: Math.floor(Date.now() / 1000) + 3600 };

    await updateWiki({ title: 'Updated', content: 'New content', topic: 'test' }, future);

    expect(lastSignedEvent.created_at).toBe(future.created_at + 1);
  });
});
