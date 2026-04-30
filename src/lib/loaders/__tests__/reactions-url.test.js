/**
 * Tests for reactionsLoaderForUrl — kind 17 (NIP-25 external) reactions
 * for URL-rooted threads. Mirrors createCommentLoaderForUrl.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

/** @type {any[]} */
let capturedRelays;
/** @type {any[]} */
let capturedFilters;

vi.mock('$lib/loaders/base.js', () => ({
  createCachedTimelineLoader: vi.fn((relays, filter) => {
    capturedRelays = relays;
    capturedFilters = filter;
    return () => of();
  })
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: ['wss://relay.example'] }
}));

beforeEach(() => {
  capturedRelays = [];
  capturedFilters = [];
});

describe('reactionsLoaderForUrl', () => {
  it('builds a kind 17 filter with the #i URL tag and limit 100', async () => {
    const { reactionsLoaderForUrl } = await import('$lib/loaders/reactions.js');
    reactionsLoaderForUrl('https://example.com/article');
    expect(capturedFilters).toEqual({
      kinds: [17],
      '#i': ['https://example.com/article'],
      limit: 100
    });
  });

  it('uses fallback relays by default', async () => {
    const { reactionsLoaderForUrl } = await import('$lib/loaders/reactions.js');
    reactionsLoaderForUrl('https://example.com/article');
    expect(capturedRelays).toContain('wss://relay.example');
  });

  it('appends extra relays when provided', async () => {
    const { reactionsLoaderForUrl } = await import('$lib/loaders/reactions.js');
    reactionsLoaderForUrl('https://example.com/article', ['wss://extra.example']);
    expect(capturedRelays).toContain('wss://relay.example');
    expect(capturedRelays).toContain('wss://extra.example');
  });

  it('deduplicates relay list', async () => {
    const { reactionsLoaderForUrl } = await import('$lib/loaders/reactions.js');
    reactionsLoaderForUrl('https://example.com/article', ['wss://relay.example']);
    const occurrences = capturedRelays.filter((r) => r === 'wss://relay.example').length;
    expect(occurrences).toBe(1);
  });

  it('throws when url is empty', async () => {
    const { reactionsLoaderForUrl } = await import('$lib/loaders/reactions.js');
    expect(() => reactionsLoaderForUrl('')).toThrow();
  });
});
