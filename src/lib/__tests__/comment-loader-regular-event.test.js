/**
 * Comment loader tests for regular events (kind 11 threads)
 *
 * Tests that createCommentLoaderForEvent auto-detects event type
 * and uses #E filter for regular events, #A filter for addressable events.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

// Mock dependencies before imports
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn(() => vi.fn())
}));
vi.mock('applesauce-core/helpers', () => ({
  getSeenRelays: vi.fn(() => undefined)
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {}
}));
vi.mock('$lib/loaders/base.js', async () => {
  const { createTimelineLoader } = /** @type {any} */ (await import('applesauce-loaders/loaders'));
  return {
    timedPool: vi.fn(),
    createCachedTimelineLoader: (
      /** @type {string[]} */ relays,
      /** @type {any} */ filter,
      /** @type {any} */ opts = {}
    ) => createTimelineLoader(vi.fn(), relays, filter, { eventStore: {}, ...opts })
  };
});
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: ['wss://relay.example.com'] }
}));

import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { getSeenRelays } from 'applesauce-core/helpers';
import { createCommentLoaderForEvent } from '$lib/loaders/comments.js';

describe('createCommentLoaderForEvent', () => {
  it('uses #E filter for regular events (e.g. kind 11)', () => {
    const regularEvent = {
      id: 'abc123',
      kind: 11,
      pubkey: 'author1',
      tags: [['title', 'My Thread']],
      created_at: 1700000000,
      content: 'Thread content'
    };

    createCommentLoaderForEvent(regularEvent);

    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({
        kinds: [1111],
        '#E': ['abc123'],
        limit: 100
      }),
      expect.objectContaining({ eventStore: expect.anything() })
    );

    // Should NOT have #A filter
    const filter = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[2];
    expect(filter).not.toHaveProperty('#A');
  });

  it('uses #A filter for addressable events (kind 30000-39999)', () => {
    const addressableEvent = {
      id: 'xyz789',
      kind: 31923,
      pubkey: 'author2',
      tags: [['d', 'my-event']],
      created_at: 1700000000,
      content: ''
    };

    createCommentLoaderForEvent(addressableEvent);

    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({
        kinds: [1111],
        '#A': ['31923:author2:my-event'],
        limit: 100
      }),
      expect.objectContaining({ eventStore: expect.anything() })
    );

    // Should NOT have #E filter
    const filter = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[2];
    expect(filter).not.toHaveProperty('#E');
  });

  it('handles addressable event with empty d-tag', () => {
    const event = {
      id: 'evt1',
      kind: 30142,
      pubkey: 'author3',
      tags: [],
      created_at: 1700000000,
      content: ''
    };

    createCommentLoaderForEvent(event);

    const filter = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[2];
    expect(filter['#A']).toEqual(['30142:author3:']);
  });

  it('throws when called with null/undefined event', () => {
    expect(() => createCommentLoaderForEvent(null)).toThrow();
    expect(() => createCommentLoaderForEvent(undefined)).toThrow();
  });

  it('includes seen relays from root event in relay list', () => {
    const seenSet = new Set(['wss://communikey.relay/', 'wss://relay.example.com/']);
    vi.mocked(getSeenRelays).mockReturnValueOnce(seenSet);

    const event = {
      id: 'thread1',
      kind: 11,
      pubkey: 'author5',
      tags: [],
      created_at: 1700000000,
      content: 'Thread'
    };

    createCommentLoaderForEvent(event);

    const relays = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[1];
    expect(relays).toContain('wss://relay.example.com');
    expect(relays).toContain('wss://communikey.relay/');
  });

  it('includes extra relays when provided', () => {
    vi.mocked(getSeenRelays).mockReturnValueOnce(undefined);

    const event = {
      id: 'thread2',
      kind: 11,
      pubkey: 'author6',
      tags: [],
      created_at: 1700000000,
      content: 'Thread'
    };

    createCommentLoaderForEvent(event, ['wss://extra.relay/']);

    const relays = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[1];
    expect(relays).toContain('wss://relay.example.com');
    expect(relays).toContain('wss://extra.relay/');
  });

  it('creates dual-filter loader for kind 1 (NIP-22 + NIP-10)', () => {
    const event = {
      id: 'note123',
      kind: 1,
      pubkey: 'author4',
      tags: [],
      created_at: 1700000000,
      content: 'Hello world'
    };

    const result = createCommentLoaderForEvent(event);

    // Should create two timeline loaders
    const calls = /** @type {any} */ (createTimelineLoader).mock.calls;
    const lastTwoCalls = calls.slice(-2);

    // One for NIP-22 (kind 1111, #E)
    const nip22Call = lastTwoCalls.find((/** @type {any} */ c) => c[2].kinds[0] === 1111);
    expect(nip22Call).toBeDefined();
    expect(nip22Call[2]['#E']).toEqual(['note123']);

    // One for NIP-10 (kind 1, #e)
    const nip10Call = lastTwoCalls.find((/** @type {any} */ c) => c[2].kinds[0] === 1);
    expect(nip10Call).toBeDefined();
    expect(nip10Call[2]['#e']).toEqual(['note123']);

    // Result should be a function (merged loader)
    expect(typeof result).toBe('function');
  });

  it('uses single #E filter for non-kind-1 regular events', () => {
    const event = {
      id: 'thread1',
      kind: 11,
      pubkey: 'author7',
      tags: [],
      created_at: 1700000000,
      content: 'Forum thread'
    };

    createCommentLoaderForEvent(event);

    const filter = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[2];
    expect(filter.kinds).toEqual([1111]);
    expect(filter['#E']).toEqual(['thread1']);
    expect(filter).not.toHaveProperty('#e');
  });
});
