/**
 * Comment loader tests for URL-rooted page notes (NIP-22 with external root).
 *
 * Page notes are kind 1111 carrying ["I", url] + ["K", "web"] root tags
 * (NIP-22 external pointers). They're discoverable via the #I tag filter.
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
import { createCommentLoaderForUrl } from '$lib/loaders/comments.js';

describe('createCommentLoaderForUrl', () => {
  it('uses #I filter with the URL', () => {
    createCommentLoaderForUrl('https://example.com/article');

    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({
        kinds: [1111],
        '#I': ['https://example.com/article'],
        limit: 100
      }),
      expect.objectContaining({ eventStore: expect.anything() })
    );

    const filter = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[2];
    expect(filter).not.toHaveProperty('#E');
    expect(filter).not.toHaveProperty('#A');
  });

  it('includes fallback relays', () => {
    createCommentLoaderForUrl('https://example.com/x');

    const relays = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[1];
    expect(relays).toContain('wss://relay.example.com');
  });

  it('includes extra relays when provided', () => {
    createCommentLoaderForUrl('https://example.com/y', ['wss://community.relay/']);

    const relays = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[1];
    expect(relays).toContain('wss://relay.example.com');
    expect(relays).toContain('wss://community.relay/');
  });

  it('deduplicates relays', () => {
    createCommentLoaderForUrl('https://example.com/z', [
      'wss://relay.example.com',
      'wss://relay.example.com'
    ]);

    const relays = /** @type {any} */ (createTimelineLoader).mock.calls.at(-1)[1];
    const occurrences = relays.filter((/** @type {string} */ r) => r === 'wss://relay.example.com');
    expect(occurrences.length).toBe(1);
  });

  it('throws when url is missing', () => {
    expect(() => createCommentLoaderForUrl('')).toThrow();
    expect(() => createCommentLoaderForUrl(/** @type {any} */ (undefined))).toThrow();
    expect(() => createCommentLoaderForUrl(/** @type {any} */ (null))).toThrow();
  });
});
