/**
 * Repost Feed Merge/Group Tests
 *
 * Tests the pure mergeRepostsIntoFeed() function that integrates
 * NIP-18 reposts into the follows feed with grouping and deduplication.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

// Mock applesauce helpers before importing the module under test
vi.mock('applesauce-common/helpers', () => ({
  getSharedEventPointer: vi.fn((event) => {
    const eTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'e');
    if (!eTag) return undefined;
    return { id: eTag[1], relays: eTag[2] ? [eTag[2]] : [] };
  }),
  getSharedAddressPointer: vi.fn((event) => {
    const aTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'a');
    if (!aTag) return undefined;
    const [kind, pubkey, identifier] = aTag[1].split(':');
    return { kind: parseInt(kind), pubkey, identifier };
  })
}));

import { mergeRepostsIntoFeed } from '$lib/helpers/repost-feed.js';

/**
 * @param {Partial<{id: string, kind: number, pubkey: string, tags: string[][], created_at: number, content: string}>} overrides
 */
function mockEvent(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    kind: overrides.kind || 1,
    pubkey: overrides.pubkey || 'author1',
    tags: overrides.tags || [],
    created_at: overrides.created_at || 1000,
    content: overrides.content || 'hello world'
  };
}

/**
 * Create a kind 6 repost event (repost of kind 1)
 * @param {string} targetId - ID of the event being reposted
 * @param {Partial<{pubkey: string, created_at: number}>} overrides
 */
function mockRepost(targetId, overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 6,
    pubkey: overrides.pubkey || 'reposter1',
    tags: [
      ['e', targetId],
      ['p', 'author1']
    ],
    created_at: overrides.created_at || 2000,
    content: ''
  };
}

/**
 * Create a kind 16 generic repost event
 * @param {string} targetId - ID of the event being reposted
 * @param {number} targetKind - Kind of the event being reposted
 * @param {Partial<{pubkey: string, created_at: number, aTag: string}>} overrides
 */
function mockGenericRepost(targetId, targetKind, overrides = {}) {
  const tags = [
    ['e', targetId],
    ['p', 'author1'],
    ['k', String(targetKind)]
  ];
  if (overrides.aTag) {
    tags.push(['a', overrides.aTag]);
  }
  return {
    id: Math.random().toString(36).slice(2),
    kind: 16,
    pubkey: overrides.pubkey || 'reposter1',
    tags,
    created_at: overrides.created_at || 2000,
    content: ''
  };
}

/**
 * Build a feed entry (matches ProfileFeedView format)
 * @param {string} type
 * @param {any} data
 * @param {number} ts
 */
function feedEntry(type, data, ts) {
  return { type, data, ts };
}

describe('mergeRepostsIntoFeed', () => {
  it('adds a repost of kind 1 note as "notes" category', () => {
    const original = mockEvent({ id: 'note1', kind: 1 });
    const repost = mockRepost('note1', { pubkey: 'alice' });
    const lookup = new Map([['note1', original]]);

    const result = mergeRepostsIntoFeed([], [repost], lookup);

    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('notes');
    expect(result[0]?.data).toBe(original);
    expect(result[0]?.ts).toBe(repost.created_at);
    expect(result[0]?.repost?.sharers).toEqual(['alice']);
  });

  it('adds a kind 16 repost of kind 30142 as "resources" category', () => {
    const original = mockEvent({ id: 'res1', kind: 30142 });
    const repost = mockGenericRepost('res1', 30142, { pubkey: 'bob' });
    const lookup = new Map([['res1', original]]);

    const result = mergeRepostsIntoFeed([], [repost], lookup);

    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('resources');
    expect(result[0]?.repost?.sharers).toEqual(['bob']);
  });

  it('adds a kind 16 repost of kind 31922 as "calendar" category', () => {
    const original = mockEvent({ id: 'cal1', kind: 31922 });
    const repost = mockGenericRepost('cal1', 31922, { pubkey: 'carol' });
    const lookup = new Map([['cal1', original]]);

    const result = mergeRepostsIntoFeed([], [repost], lookup);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('calendar');
  });

  it('groups multiple reposts of the same event', () => {
    const original = mockEvent({ id: 'note1', kind: 1 });
    const repost1 = mockRepost('note1', { pubkey: 'alice', created_at: 2000 });
    const repost2 = mockRepost('note1', { pubkey: 'bob', created_at: 2500 });
    const lookup = new Map([['note1', original]]);

    const result = mergeRepostsIntoFeed([], [repost1, repost2], lookup);

    expect(result).toHaveLength(1);
    expect(result[0]?.repost?.sharers).toEqual(['alice', 'bob']);
    // Sort position uses the latest repost timestamp
    expect(result[0]?.ts).toBe(2500);
  });

  it('attaches repost metadata to existing direct post without changing ts', () => {
    const original = mockEvent({ id: 'note1', kind: 1, created_at: 500 });
    const directEntry = feedEntry('notes', original, 500);
    const repost = mockRepost('note1', { pubkey: 'alice', created_at: 2000 });
    const lookup = new Map([['note1', original]]);

    const result = mergeRepostsIntoFeed([directEntry], [repost], lookup);

    // Should still be 1 entry (not duplicated)
    expect(result).toHaveLength(1);
    expect(result[0]?.ts).toBe(500); // keeps direct post's timestamp
    expect(result[0]?.repost?.sharers).toEqual(['alice']);
  });

  it('skips reposts with unresolved targets', () => {
    const repost = mockRepost('unknown-id', { pubkey: 'alice' });
    const lookup = new Map(); // empty — target not resolved

    const result = mergeRepostsIntoFeed([], [repost], lookup);

    expect(result).toHaveLength(0);
  });

  it('filters out reposts of unsupported kinds', () => {
    // Kind 30301 (kanban board) is not in FEED_CATEGORIES
    const original = mockEvent({ id: 'board1', kind: 30301 });
    const repost = mockGenericRepost('board1', 30301, { pubkey: 'alice' });
    const lookup = new Map([['board1', original]]);

    const result = mergeRepostsIntoFeed([], [repost], lookup);

    expect(result).toHaveLength(0);
  });

  it('deduplicates same reposter appearing twice', () => {
    const original = mockEvent({ id: 'note1', kind: 1 });
    const repost1 = mockRepost('note1', { pubkey: 'alice', created_at: 2000 });
    const repost2 = mockRepost('note1', { pubkey: 'alice', created_at: 2500 });
    const lookup = new Map([['note1', original]]);

    const result = mergeRepostsIntoFeed([], [repost1, repost2], lookup);

    expect(result).toHaveLength(1);
    expect(result[0]?.repost?.sharers).toEqual(['alice']); // not ['alice', 'alice']
  });

  it('resolves kind 16 repost via a-tag when e-tag lookup fails', () => {
    const original = mockEvent({
      id: 'res1',
      kind: 30142,
      pubkey: 'author1',
      tags: [['d', 'my-resource']]
    });
    // Repost with a-tag but e-tag pointing to unknown ID
    const repost = mockGenericRepost('unknown-id', 30142, {
      pubkey: 'alice',
      aTag: '30142:author1:my-resource'
    });
    const lookup = new Map([
      // Only addressable lookup, not by event ID
      ['30142:author1:my-resource', original]
    ]);

    const result = mergeRepostsIntoFeed([], [repost], lookup);

    expect(result).toHaveLength(1);
    expect(result[0].data).toBe(original);
    expect(result[0].type).toBe('resources');
  });

  it('preserves existing feed entries that have no reposts', () => {
    const note1 = mockEvent({ id: 'n1', kind: 1, created_at: 1000 });
    const note2 = mockEvent({ id: 'n2', kind: 1, created_at: 900 });
    const entries = [feedEntry('notes', note1, 1000), feedEntry('notes', note2, 900)];

    const result = mergeRepostsIntoFeed(entries, [], new Map());

    expect(result).toHaveLength(2);
    expect(result[0].repost).toBeUndefined();
    expect(result[1].repost).toBeUndefined();
  });

  it('handles mix of direct posts and reposts correctly', () => {
    const directNote = mockEvent({ id: 'n1', kind: 1, pubkey: 'followed1', created_at: 1000 });
    const repostedNote = mockEvent({ id: 'n2', kind: 1, pubkey: 'stranger', created_at: 500 });
    const entries = [feedEntry('notes', directNote, 1000)];
    const repost = mockRepost('n2', { pubkey: 'followed2', created_at: 1500 });
    const lookup = new Map([
      ['n1', directNote],
      ['n2', repostedNote]
    ]);

    const result = mergeRepostsIntoFeed(entries, [repost], lookup);

    expect(result).toHaveLength(2);
    // Direct post unchanged
    const direct = result.find((e) => e.data.id === 'n1');
    expect(direct?.repost).toBeUndefined();
    // Reposted note appears with repost metadata
    const reposted = result.find((e) => e.data.id === 'n2');
    expect(reposted?.repost?.sharers).toEqual(['followed2']);
    expect(reposted?.ts).toBe(1500);
  });
});
