/**
 * Article Actions Tests
 *
 * Tests for creating and updating NIP-23 long-form articles (kind 30023).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

// Track signed events
/** @type {any} */
let lastSignedEvent = null;
/** @type {any} */
let _lastPublishCall = null;

// Mock dependencies (the real $lib/helpers/event-factory.js wrapper runs)
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

vi.mock('$lib/helpers/protected-publish-feedback.js', () => ({
  announceProtectedPublish: vi.fn()
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => ['wss://longform.relay'])
}));

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPrimaryWriteRelay: vi.fn(async () => 'wss://write.relay')
}));

vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: vi.fn(async () => ({ success: true }))
}));

import { manager } from '$lib/stores/accounts.svelte';
import {
  createArticle,
  updateArticle,
  publishDraft,
  ARTICLE_DRAFT_KIND
} from '../stores/article-actions.svelte.js';
import { deleteEvent } from '$lib/helpers/eventDeletion.js';
import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
import { announceProtectedPublish } from '$lib/helpers/protected-publish-feedback.js';

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

  it('p-tags people mentioned in the body (bare npubs repaired) and hands them to the outbox', async () => {
    const alice = 'a'.repeat(64);
    const bob = 'b'.repeat(64);
    await createArticle({
      title: 'T',
      content: `Thanks nostr:${nip19.npubEncode(alice)} and ${nip19.npubEncode(bob)}`
    });
    expect(lastSignedEvent.tags).toContainEqual(['p', alice]);
    expect(lastSignedEvent.tags).toContainEqual(['p', bob]);
    expect(lastSignedEvent.content).toContain(`nostr:${nip19.npubEncode(bob)}`);
    expect(/** @type {any} */ (publishEventOptimistic).mock.calls[0][1]).toEqual([alice, bob]);
  });

  it('credits linked creators with marked p-tags and sends them the article', async () => {
    const corinna = 'c'.repeat(64);
    await createArticle({
      title: 'T',
      content: 'body',
      creators: [{ name: 'Corinna', type: 'Person', pubkey: nip19.npubEncode(corinna) }]
    });
    expect(lastSignedEvent.tags).toContainEqual(['p', corinna, 'wss://write.relay', 'creator']);
    expect(/** @type {any} */ (publishEventOptimistic).mock.calls[0][1]).toEqual([corinna]);
  });

  it('keeps the creator marker when the creator is also mentioned in the body', async () => {
    const corinna = 'c'.repeat(64);
    await createArticle({
      title: 'T',
      content: `Von nostr:${nip19.npubEncode(corinna)}`,
      creators: [{ name: 'Corinna', type: 'Person', pubkey: corinna, role: 'contributor' }]
    });
    const pTags = lastSignedEvent.tags.filter((/** @type {any} */ t) => t[0] === 'p');
    expect(pTags).toEqual([['p', corinna, 'wss://write.relay', 'contributor']]);
  });

  it('saves a draft as kind 30024 (NIP-23) when asked', async () => {
    const result = await createArticle({ title: 'T', content: 'body' }, undefined, null, {
      draft: true
    });
    expect(lastSignedEvent.kind).toBe(ARTICLE_DRAFT_KIND);
    expect(lastSignedEvent.kind).toBe(30024);
    expect(result.naddr).toBe('naddr1test');
    expect(deleteEvent).not.toHaveBeenCalled();
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
      expect.objectContaining({ communityEvent })
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
      expect.objectContaining({ communityEvent: null })
    );
  });

  it('encodes naddr with longform relays', async () => {
    await createArticle({ title: 'Test', content: 'Body' });

    expect(encodeEventToNaddr).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-id-123' }),
      ['wss://longform.relay']
    );
  });

  it('republishes the cover license attestation alongside the article (fd042051)', async () => {
    /** @type {any} */
    const licenseEvent = { id: 'lic1', kind: 1063, tags: [['x', 'h'.repeat(64)]] };

    await createArticle({ title: 'Test', content: 'Body', imageLicenseEvent: licenseEvent });

    expect(publishEventOptimistic).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 30023 }),
      [],
      { communityEvent: null, companions: [licenseEvent] }
    );
  });
});

describe('protected articles (NIP-70)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    /** @type {any} */ (manager).active = {
      pubkey: 'abc123',
      signEvent: vi.fn(async (/** @type {any} */ template) => {
        lastSignedEvent = { ...template, id: 'p-id', pubkey: 'abc123', sig: 's' };
        return lastSignedEvent;
      })
    };
  });

  it('adds the ["-"] tag and reports the accepting relays when protected', async () => {
    await createArticle({ title: 'T', content: 'Body', protected: true });
    expect(lastSignedEvent.tags).toContainEqual(['-']);
    const opts = /** @type {any} */ (publishEventOptimistic).mock.calls[0][2];
    expect(opts.onStatusChange).toBe(announceProtectedPublish);
  });

  it('carries no ["-"] tag by default', async () => {
    await createArticle({ title: 'T', content: 'Body' });
    expect(lastSignedEvent.tags.some((/** @type {string[]} */ t) => t[0] === '-')).toBe(false);
    const opts = /** @type {any} */ (publishEventOptimistic).mock.calls[0][2];
    expect(opts.onStatusChange).toBeUndefined();
  });

  it('an edit follows the toggle: un-protecting drops the tag', async () => {
    const existing = {
      id: 'x',
      kind: 30023,
      pubkey: 'abc123',
      content: 'Old',
      created_at: 1699000000,
      tags: [['d', 'slug'], ['title', 'Old'], ['-']],
      sig: 's'
    };
    await updateArticle({ title: 'New', content: 'New body', protected: false }, existing);
    expect(lastSignedEvent.tags.some((/** @type {string[]} */ t) => t[0] === '-')).toBe(false);
    await updateArticle({ title: 'New', content: 'New body', protected: true }, existing);
    expect(lastSignedEvent.tags.filter((/** @type {string[]} */ t) => t[0] === '-')).toEqual([
      ['-']
    ]);
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

  it('p-tags people mentioned in the updated body and hands them to the outbox', async () => {
    const alice = 'a'.repeat(64);
    await updateArticle(
      { title: 'New Title', content: `Hi nostr:${nip19.npubEncode(alice)}` },
      existingEvent
    );
    expect(lastSignedEvent.tags).toContainEqual(['p', alice]);
    expect(/** @type {any} */ (publishEventOptimistic).mock.calls[0][1]).toEqual([alice]);
  });

  it('re-credits creators from the form on update', async () => {
    const corinna = 'c'.repeat(64);
    const existing = {
      ...existingEvent,
      tags: [...existingEvent.tags, ['p', 'd'.repeat(64), '', 'creator']]
    };
    await updateArticle(
      { title: 'T', content: 'body', creators: [{ name: '', type: 'Person', pubkey: corinna }] },
      existing
    );
    const pTags = lastSignedEvent.tags.filter((/** @type {any} */ t) => t[0] === 'p');
    expect(pTags).toEqual([['p', corinna, 'wss://write.relay', 'creator']]);
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

  it('stamps created_at strictly newer than the version it replaces (#64)', async () => {
    // A same-second edit ties, and on a tie nostr-idb keeps the OLD version
    // deterministically — the cache then serves it without asking a relay.
    // Same bug as the calendar edit path in #62.
    const future = { ...existingEvent, created_at: Math.floor(Date.now() / 1000) + 3600 };

    await updateArticle({ title: 'New Title', content: 'New content' }, future);

    expect(lastSignedEvent.created_at).toBe(future.created_at + 1);
  });

  it('validates required fields', async () => {
    await expect(updateArticle({ title: '', content: 'Body' }, existingEvent)).rejects.toThrow(
      'Title is required'
    );

    await expect(updateArticle({ title: 'Test', content: '' }, existingEvent)).rejects.toThrow(
      'Article content is required'
    );
  });

  it('keeps a draft a draft when saving it again (same d-tag, no deletion)', async () => {
    const draft = { ...existingEvent, kind: 30024 };
    await updateArticle({ title: 'T', content: 'body' }, draft, null, { draft: true });
    expect(lastSignedEvent.kind).toBe(30024);
    expect(lastSignedEvent.tags).toContainEqual(['d', 'my-article-slug']);
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('publishes a draft as kind 30023 with the same d-tag and retires the draft', async () => {
    const draft = { ...existingEvent, kind: 30024 };
    await updateArticle({ title: 'T', content: 'body' }, draft, null);
    expect(lastSignedEvent.kind).toBe(30023);
    expect(lastSignedEvent.tags).toContainEqual(['d', 'my-article-slug']);
    expect(deleteEvent).toHaveBeenCalledWith(draft, /** @type {any} */ (manager).active);
  });

  it('never demotes a published article to a draft', async () => {
    await expect(
      updateArticle({ title: 'T', content: 'body' }, existingEvent, null, { draft: true })
    ).rejects.toThrow(/published/i);
    expect(lastSignedEvent).toBeNull();
  });

  it('requires d-tag on existing event', async () => {
    const noDTag = { ...existingEvent, tags: [['title', 'Old']] };

    await expect(updateArticle({ title: 'Test', content: 'Body' }, noDTag)).rejects.toThrow(
      'missing d-tag'
    );
  });
});

describe('publishDraft', () => {
  const draft = {
    id: 'draft-id',
    kind: 30024,
    pubkey: 'abc123',
    created_at: 1700000000,
    content: '# Draft body',
    tags: [
      ['d', 'draft-d'],
      ['title', 'Draft title'],
      ['published_at', '1600000000'],
      ['t', 'test'],
      ['license:id', 'https://creativecommons.org/licenses/by/4.0/'],
      ['p', 'c'.repeat(64), 'wss://relay', 'creator']
    ],
    sig: 'sig'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastSignedEvent = null;
    /** @type {any} */ (manager).active = {
      pubkey: 'abc123',
      signEvent: vi.fn(async (/** @type {any} */ template) => {
        lastSignedEvent = { ...template, id: 'published-id', pubkey: 'abc123', sig: 'sig' };
        return lastSignedEvent;
      })
    };
  });

  it('republishes the draft verbatim as kind 30023, refreshes published_at and retires the draft', async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await publishDraft(draft);
    expect(lastSignedEvent.kind).toBe(30023);
    expect(lastSignedEvent.content).toBe('# Draft body');
    expect(lastSignedEvent.tags).toContainEqual(['d', 'draft-d']);
    expect(lastSignedEvent.tags).toContainEqual(['title', 'Draft title']);
    expect(lastSignedEvent.tags).toContainEqual([
      'license:id',
      'https://creativecommons.org/licenses/by/4.0/'
    ]);
    expect(lastSignedEvent.tags).toContainEqual(['p', 'c'.repeat(64), 'wss://relay', 'creator']);
    const publishedAt = Number(
      lastSignedEvent.tags.find((/** @type {any} */ t) => t[0] === 'published_at')[1]
    );
    expect(publishedAt).toBeGreaterThanOrEqual(before);
    expect(publishEventOptimistic).toHaveBeenCalled();
    expect(deleteEvent).toHaveBeenCalledWith(draft, /** @type {any} */ (manager).active);
    expect(result.naddr).toBe('naddr1test');
  });

  it("refuses to publish someone else's draft or a non-draft", async () => {
    await expect(publishDraft({ ...draft, pubkey: 'other' })).rejects.toThrow(/own/i);
    await expect(publishDraft({ ...draft, kind: 30023 })).rejects.toThrow(/draft/i);
  });
});
