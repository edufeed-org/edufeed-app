/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';

// Spy on the loader factories before importing base.js so we capture the
// options passed at module init.
// The loader returned by createAddressLoader: revalidation re-enters it with
// `cache: false`, so it must hand back something subscribable.
/** @type {import('vitest').Mock<(...args: any[]) => any>} */
const addressLoaderFn = vi.fn(() => ({ subscribe: vi.fn() }));
/** @type {import('vitest').Mock<(...args: any[]) => any>} */
const createAddressLoaderSpy = vi.fn((/** @type {any[]} */ ..._args) => addressLoaderFn);
/** @type {import('vitest').Mock<(...args: any[]) => any>} */
const createEventLoaderSpy = vi.fn((/** @type {any[]} */ ..._args) => vi.fn());
/** @type {import('vitest').Mock<(...args: any[]) => any>} */
const createUnifiedEventLoaderSpy = vi.fn((/** @type {any[]} */ ..._args) => vi.fn());
/** @type {import('vitest').Mock<(...args: any[]) => any>} */
const createTimelineLoaderSpy = vi.fn((/** @type {any[]} */ ..._args) => vi.fn());

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
/** @type {import('vitest').Mock<(...args: any[]) => any>} */
const rawCacheRequest = vi.fn(async () => []);
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  cacheRequest: rawCacheRequest
}));

const PUBKEY = 'p'.repeat(64);
/** @param {Partial<import('nostr-tools').Event>} over */
const cachedProfile = (over = {}) => ({
  id: 'a'.repeat(64),
  kind: 0,
  pubkey: PUBKEY,
  created_at: 1000,
  tags: [],
  content: '{}',
  sig: 's'.repeat(128),
  ...over
});

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

describe('cache hits are revalidated against relays', () => {
  it('addressLoader re-requests a cached replaceable with cache: false', async () => {
    await import('$lib/loaders/base.js');
    const opts = createAddressLoaderSpy.mock.calls[0][1];
    addressLoaderFn.mockClear();
    rawCacheRequest.mockResolvedValueOnce([cachedProfile()]);

    const result = await opts.cacheRequest([{ kinds: [0], authors: [PUBKEY] }]);

    expect(result).toHaveLength(1);
    expect(addressLoaderFn).toHaveBeenCalledWith({ kind: 0, pubkey: PUBKEY, cache: false });
  });

  it('the unified loader shares the same revalidating cache request', async () => {
    await import('$lib/loaders/base.js');
    const opts = createUnifiedEventLoaderSpy.mock.calls[0][1];
    addressLoaderFn.mockClear();
    const other = 'q'.repeat(64);
    rawCacheRequest.mockResolvedValueOnce([cachedProfile({ id: 'b'.repeat(64), pubkey: other })]);

    await opts.cacheRequest([{ kinds: [0], authors: [other] }]);

    expect(addressLoaderFn).toHaveBeenCalledWith({ kind: 0, pubkey: other, cache: false });
  });

  it('the plain event loader is left on the raw cache (regular events are immutable)', async () => {
    await import('$lib/loaders/base.js');
    const opts = createEventLoaderSpy.mock.calls[0][1];
    expect(opts.cacheRequest).toBe(rawCacheRequest);
  });
});
