/**
 * Comment loader tests for regular events (kind 11 threads)
 *
 * Tests that createCommentLoaderForEvent auto-detects event type
 * and uses #E filter for regular events, #A filter for addressable events.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';

// Mock dependencies before imports
vi.mock('applesauce-core/helpers', () => ({
  getSeenRelays: vi.fn(() => undefined),
  normalizeURL: (/** @type {string} */ u) => (u.endsWith('/') ? u : u + '/')
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  fetchRelayList: vi.fn(async () => null)
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {}
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  fetchEvents: vi.fn(() => of())
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: ['wss://relay.example.com'] }
}));

import { fetchEvents } from '$lib/loaders/base.js';
import { getSeenRelays } from 'applesauce-core/helpers';
import { fetchRelayList } from '$lib/services/relay-service.svelte.js';
import { lastValueFrom } from 'rxjs';
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

    expect(fetchEvents).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        kinds: [1111],
        '#E': ['abc123'],
        limit: 100
      }),
      { cache: true }
    );

    // Should NOT have #A filter
    const filter = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[1];
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

    expect(fetchEvents).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        kinds: [1111],
        '#A': ['31923:author2:my-event'],
        limit: 100
      }),
      { cache: true }
    );

    // Should NOT have #E filter
    const filter = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[1];
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

    const filter = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[1];
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

    const relays = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[0];
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

    const relays = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[0];
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

    // Should request both filters
    const calls = /** @type {any} */ (fetchEvents).mock.calls;
    const lastTwoCalls = calls.slice(-2);

    // One for NIP-22 (kind 1111, #E)
    const nip22Call = lastTwoCalls.find((/** @type {any} */ c) => c[1].kinds[0] === 1111);
    expect(nip22Call).toBeDefined();
    expect(nip22Call[1]['#E']).toEqual(['note123']);

    // One for NIP-10 (kind 1, #e)
    const nip10Call = lastTwoCalls.find((/** @type {any} */ c) => c[1].kinds[0] === 1);
    expect(nip10Call).toBeDefined();
    expect(nip10Call[1]['#e']).toEqual(['note123']);

    // Result is the merged observable
    expect(typeof result.subscribe).toBe('function');
  });

  it("also asks the root author's NIP-65 read+write relays, minus those already asked", async () => {
    vi.mocked(fetchRelayList).mockResolvedValueOnce({
      readRelays: ['wss://inbox.author/'],
      writeRelays: ['wss://relay.example.com', 'wss://outbox.author']
    });
    const event = { id: 'art1', kind: 30023, pubkey: 'author8', tags: [['d', 'x']] };

    await lastValueFrom(createCommentLoaderForEvent(event), { defaultValue: undefined });

    expect(fetchRelayList).toHaveBeenCalledWith('author8');
    const authorCall = /** @type {any} */ (fetchEvents).mock.calls.find(
      (/** @type {any} */ c) => c[2].cache === false
    );
    expect(authorCall[0]).toEqual(['wss://inbox.author/', 'wss://outbox.author/']);
    expect(authorCall[1]['#A']).toEqual(['30023:author8:x']);
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

    const filter = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[1];
    expect(filter.kinds).toEqual([1111]);
    expect(filter['#E']).toEqual(['thread1']);
    expect(filter).not.toHaveProperty('#e');
  });
});
