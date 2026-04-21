/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn(),
  createAddressLoader: vi.fn(() => vi.fn()),
  createEventLoader: vi.fn(() => vi.fn()),
  createUnifiedEventLoader: vi.fn(() => vi.fn())
}));
vi.mock('applesauce-relay/operators', () => ({
  onlyEvents: vi.fn()
}));
vi.mock('applesauce-core/observable', () => ({
  mapEventsToStore: vi.fn()
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {
    request: vi.fn(),
    subscription: vi.fn()
  },
  eventStore: {
    add: vi.fn(),
    set eventLoader(/** @type {any} */ _) {}
  }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: vi.fn(() => ['wss://relay1.example.com', 'wss://relay2.example.com']),
  getEventLoaderLookupRelays: () => []
}));
vi.mock('$lib/loaders/targeted-publications.js', () => ({
  communityTargetedPublicationsLoader: vi.fn(() => vi.fn(() => ({ subscribe: vi.fn() })))
}));

const { createTimelineLoader } = await import('applesauce-loaders/loaders');
const { loadEventHighlights } = await import('$lib/loaders/event-highlights.js');

describe('loadEventHighlights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockLoaderFn = vi.fn(() => ({ subscribe: vi.fn() }));
    /** @type {any} */ (createTimelineLoader).mockReturnValue(mockLoaderFn);
  });

  it('builds correct filter with #a tag from AddressPointer', () => {
    const pointer = { kind: 30023, pubkey: 'abc123', identifier: 'my-article' };

    loadEventHighlights(pointer);

    // createTimelineLoader is called in base.js too, so find the call for 9802
    const calls = /** @type {any} */ (createTimelineLoader).mock.calls;
    const highlightCall = calls.find((/** @type {any} */ c) => c[2]?.kinds?.[0] === 9802);

    expect(highlightCall).toBeTruthy();
    expect(highlightCall[2]).toEqual(
      expect.objectContaining({
        kinds: [9802],
        '#a': ['30023:abc123:my-article']
      })
    );
  });

  it('includes #h tag when communityPubkey is provided', () => {
    const pointer = { kind: 30023, pubkey: 'abc123', identifier: 'my-article' };

    loadEventHighlights(pointer, 'community456');

    const calls = /** @type {any} */ (createTimelineLoader).mock.calls;
    const highlightCall = calls.find((/** @type {any} */ c) => c[2]?.kinds?.[0] === 9802);

    expect(highlightCall[2]).toEqual(
      expect.objectContaining({
        kinds: [9802],
        '#a': ['30023:abc123:my-article'],
        '#h': ['community456']
      })
    );
  });

  it('does not include #h tag when communityPubkey is undefined', () => {
    const pointer = { kind: 30818, pubkey: 'def789', identifier: 'wiki-page' };

    loadEventHighlights(pointer);

    const calls = /** @type {any} */ (createTimelineLoader).mock.calls;
    const highlightCall = calls.find((/** @type {any} */ c) => c[2]?.kinds?.[0] === 9802);

    expect(highlightCall[2]['#h']).toBeUndefined();
    expect(highlightCall[2]['#a']).toEqual(['30818:def789:wiki-page']);
  });

  it('returns loader and cleanup functions', () => {
    const pointer = { kind: 30023, pubkey: 'abc123', identifier: 'test' };

    const result = loadEventHighlights(pointer);

    expect(result).toHaveProperty('loader');
    expect(result).toHaveProperty('cleanup');
    expect(typeof result.loader).toBe('function');
    expect(typeof result.cleanup).toBe('function');
  });

  it('cleanup unsubscribes after loader is called', () => {
    const mockUnsub = vi.fn();
    const mockLoaderFn = vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: mockUnsub })) }));
    /** @type {any} */ (createTimelineLoader).mockReturnValue(mockLoaderFn);

    const pointer = { kind: 30023, pubkey: 'abc123', identifier: 'test' };
    const { loader, cleanup } = loadEventHighlights(pointer);

    loader();
    cleanup();

    expect(mockUnsub).toHaveBeenCalled();
  });
});
