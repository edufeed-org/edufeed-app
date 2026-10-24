/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/loaders/base.js', () => ({
  fetchEvents: vi.fn()
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: vi.fn(() => ['wss://relay1.example.com', 'wss://relay2.example.com'])
}));

const { fetchEvents } = await import('$lib/loaders/base.js');
const { loadEventHighlights } = await import('$lib/loaders/event-highlights.js');

/** The (relays, filter, opts) of the last highlight request */
const lastCall = () => /** @type {any} */ (fetchEvents).mock.calls.at(-1);

describe('loadEventHighlights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    /** @type {any} */ (fetchEvents).mockReturnValue({ subscribe: vi.fn() });
  });

  it('requests kind 9802 by #a tag from all lookup relays, cache included', () => {
    const pointer = { kind: 30023, pubkey: 'abc123', identifier: 'my-article' };

    loadEventHighlights(pointer).loader();

    expect(lastCall()).toEqual([
      ['wss://relay1.example.com', 'wss://relay2.example.com'],
      { kinds: [9802], '#a': ['30023:abc123:my-article'], limit: 100 },
      { cache: true }
    ]);
  });

  it('includes #h tag when communityPubkey is provided', () => {
    const pointer = { kind: 30023, pubkey: 'abc123', identifier: 'my-article' };

    loadEventHighlights(pointer, 'community456').loader();

    expect(lastCall()[1]).toEqual(
      expect.objectContaining({
        kinds: [9802],
        '#a': ['30023:abc123:my-article'],
        '#h': ['community456']
      })
    );
  });

  it('does not include #h tag when communityPubkey is undefined', () => {
    const pointer = { kind: 30818, pubkey: 'def789', identifier: 'wiki-page' };

    loadEventHighlights(pointer).loader();

    expect(lastCall()[1]['#h']).toBeUndefined();
    expect(lastCall()[1]['#a']).toEqual(['30818:def789:wiki-page']);
  });

  it('does not request anything until loader() is called', () => {
    loadEventHighlights({ kind: 30023, pubkey: 'abc123', identifier: 'test' });
    expect(fetchEvents).not.toHaveBeenCalled();
  });

  it('returns loader and cleanup functions', () => {
    const result = loadEventHighlights({ kind: 30023, pubkey: 'abc123', identifier: 'test' });

    expect(typeof result.loader).toBe('function');
    expect(typeof result.cleanup).toBe('function');
  });

  it('cleanup unsubscribes after loader is called', () => {
    const mockUnsub = vi.fn();
    /** @type {any} */ (fetchEvents).mockReturnValue({
      subscribe: vi.fn(() => ({ unsubscribe: mockUnsub }))
    });

    const { loader, cleanup } = loadEventHighlights({
      kind: 30023,
      pubkey: 'abc123',
      identifier: 'test'
    });

    loader();
    cleanup();

    expect(mockUnsub).toHaveBeenCalled();
  });
});
