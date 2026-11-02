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
const eventLoaderFn = vi.fn();
/** @type {import('vitest').Mock<(...args: any[]) => any>} */
const createEventLoaderSpy = vi.fn((/** @type {any[]} */ ..._args) => eventLoaderFn);

vi.mock('applesauce-loaders/loaders', () => ({
  createAddressLoader: createAddressLoaderSpy,
  createEventLoader: createEventLoaderSpy
}));

// Stub deps that base.js pulls in.
/** @type {{ eventLoader: any }} */
const eventStore = { eventLoader: null };
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore
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

  // The store fallback is no second loader pair: it routes to the two loaders
  // above, so it inherits their cache wiring (and shares their in-flight requests).
  it('the store fallback routes to the shared event and address loaders', async () => {
    await import('$lib/loaders/base.js');
    expect(createEventLoaderSpy).toHaveBeenCalledTimes(1);
    expect(createAddressLoaderSpy).toHaveBeenCalledTimes(1);

    eventStore.eventLoader({ id: 'e'.repeat(64) });
    expect(eventLoaderFn).toHaveBeenCalledWith({ id: 'e'.repeat(64) });

    addressLoaderFn.mockClear();
    eventStore.eventLoader({ kind: 0, pubkey: PUBKEY });
    expect(addressLoaderFn).toHaveBeenCalledWith({ kind: 0, pubkey: PUBKEY });
  });
});

// fetchEvents' cache wiring is covered by fetch-events.test.js.

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

  it('the plain event loader is left on the raw cache (regular events are immutable)', async () => {
    await import('$lib/loaders/base.js');
    const opts = createEventLoaderSpy.mock.calls[0][1];
    expect(opts.cacheRequest).toBe(rawCacheRequest);
  });
});
