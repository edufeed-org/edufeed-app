/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

// Spy on the loader factories before importing base.js so we capture the
// options passed at module init.
const createAddressLoaderSpy = vi.fn(() => vi.fn());
const createEventLoaderSpy = vi.fn(() => vi.fn());
const createUnifiedEventLoaderSpy = vi.fn(() => vi.fn());
const createTimelineLoaderSpy = vi.fn(() => vi.fn());

vi.mock('applesauce-loaders/loaders', () => ({
  createAddressLoader: createAddressLoaderSpy,
  createEventLoader: createEventLoaderSpy,
  createUnifiedEventLoader: createUnifiedEventLoaderSpy,
  createTimelineLoader: createTimelineLoaderSpy
}));

// Stub deps that base.js pulls in.
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore: { eventLoader: null }
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => [],
  getEventLoaderLookupRelays: () => []
}));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  cacheRequest: vi.fn(async () => [])
}));

describe('base.js loader cache wiring', () => {
  it('passes cacheRequest to createAddressLoader', async () => {
    await import('$lib/loaders/base.js');
    const opts = createAddressLoaderSpy.mock.calls[0][1];
    expect(opts.cacheRequest).toBeTypeOf('function');
  });

  it('passes cacheRequest to createEventLoader', async () => {
    const opts = createEventLoaderSpy.mock.calls[0][1];
    expect(opts.cacheRequest).toBeTypeOf('function');
  });

  it('passes cacheRequest to createUnifiedEventLoader', async () => {
    const opts = createUnifiedEventLoaderSpy.mock.calls[0][1];
    expect(opts.cacheRequest).toBeTypeOf('function');
  });
});

describe('createCachedTimelineLoader', () => {
  it('passes cache: cacheRequest through to createTimelineLoader', async () => {
    createTimelineLoaderSpy.mockClear();
    const { createCachedTimelineLoader } = await import('$lib/loaders/base.js');
    createCachedTimelineLoader(['wss://a'], { kinds: [1] });
    const callArgs = createTimelineLoaderSpy.mock.calls[0];
    // Signature: (request, relays, filters, opts)
    const opts = callArgs[3];
    expect(opts.cache).toBeTypeOf('function');
    expect(opts.eventStore).toBeDefined();
  });

  it('merges caller opts without overwriting cache', async () => {
    createTimelineLoaderSpy.mockClear();
    const { createCachedTimelineLoader } = await import('$lib/loaders/base.js');
    createCachedTimelineLoader(['wss://a'], { kinds: [1] }, { limit: 50 });
    const opts = createTimelineLoaderSpy.mock.calls[0][3];
    expect(opts.limit).toBe(50);
    expect(opts.cache).toBeTypeOf('function');
  });
});
