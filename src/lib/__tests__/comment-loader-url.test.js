/**
 * Comment loader tests for URL-rooted page notes (NIP-22 with external root).
 *
 * Page notes are kind 1111 carrying ["I", url] + ["K", "web"] root tags
 * (NIP-22 external pointers). They're discoverable via the #I tag filter.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';

// Mock dependencies before imports
vi.mock('applesauce-core/helpers', () => ({
  getSeenRelays: vi.fn(() => undefined)
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
import { createCommentLoaderForUrl } from '$lib/loaders/comments.js';

describe('createCommentLoaderForUrl', () => {
  it('uses #I filter with the URL', () => {
    createCommentLoaderForUrl('https://example.com/article');

    expect(fetchEvents).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        kinds: [1111],
        '#I': ['https://example.com/article'],
        limit: 100
      }),
      { cache: true }
    );

    const filter = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[1];
    expect(filter).not.toHaveProperty('#E');
    expect(filter).not.toHaveProperty('#A');
  });

  it('includes fallback relays', () => {
    createCommentLoaderForUrl('https://example.com/x');

    const relays = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[0];
    expect(relays).toContain('wss://relay.example.com');
  });

  it('includes extra relays when provided', () => {
    createCommentLoaderForUrl('https://example.com/y', ['wss://community.relay/']);

    const relays = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[0];
    expect(relays).toContain('wss://relay.example.com');
    expect(relays).toContain('wss://community.relay/');
  });

  it('deduplicates relays', () => {
    createCommentLoaderForUrl('https://example.com/z', [
      'wss://relay.example.com',
      'wss://relay.example.com'
    ]);

    const relays = /** @type {any} */ (fetchEvents).mock.calls.at(-1)[0];
    const occurrences = relays.filter((/** @type {string} */ r) => r === 'wss://relay.example.com');
    expect(occurrences.length).toBe(1);
  });

  it('throws when url is missing', () => {
    expect(() => createCommentLoaderForUrl('')).toThrow();
    expect(() => createCommentLoaderForUrl(/** @type {any} */ (undefined))).toThrow();
    expect(() => createCommentLoaderForUrl(/** @type {any} */ (null))).toThrow();
  });
});
