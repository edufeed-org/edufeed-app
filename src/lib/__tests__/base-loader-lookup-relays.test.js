/**
 * The address / unified loaders in $lib/loaders/base.js are created at module
 * load, before /api/config has been merged into runtimeConfig. applesauce v6
 * reads the `lookupRelays` option ONCE at creation, so a plain getter is
 * snapshotted as `[]` and the EventStore fallback loader
 * (`eventStore.replaceable()` / `eventStore.profile()` on a cache miss) never
 * asks any lookup relay. These tests pin that the lookup relays are resolved
 * when a request is made, not when the loader is built.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMPTY } from 'rxjs';
import { EventStore } from 'applesauce-core';

/** @type {string[]} */
let lookupRelays = [];
/** @type {import('vitest').Mock} */
const request = vi.fn(() => EMPTY);
const eventStore = new EventStore();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: (/** @type {any[]} */ ...args) => request(...args) },
  eventStore
}));

vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  cacheRequest: vi.fn(async () => [])
}));

/** @type {string[]} */
let indexerRelays = [];
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEventLoaderLookupRelays: () => [...indexerRelays, ...lookupRelays],
  getAllLookupRelays: () => lookupRelays
}));

const POINTER = { kind: 10222, pubkey: 'ab'.repeat(32) };

/** Wait past the loaders' 1s request buffer. */
const flushBuffer = () => new Promise((r) => setTimeout(r, 1200));

describe('base loaders resolve lookup relays at request time', () => {
  beforeEach(() => {
    request.mockClear();
  });

  it('addressLoader queries lookup relays configured after module load', async () => {
    // Module evaluates while runtimeConfig is still the empty defaults.
    lookupRelays = [];
    const { addressLoader } = await import('$lib/loaders/base.js');

    // /api/config arrives.
    lookupRelays = ['wss://lookup.example/'];

    const sub = addressLoader(POINTER).subscribe();
    await flushBuffer();
    sub.unsubscribe();

    expect(request).toHaveBeenCalled();
    expect(request.mock.calls[0][0]).toEqual(['wss://lookup.example/']);
  });

  it('eventStore fallback loader (replaceable on a cold store) queries lookup relays', async () => {
    lookupRelays = [];
    await import('$lib/loaders/base.js');
    lookupRelays = ['wss://lookup.example/'];

    const sub = eventStore.replaceable({ kind: 10222, pubkey: 'cd'.repeat(32) }).subscribe();
    await flushBuffer();
    sub.unsubscribe();

    expect(request).toHaveBeenCalled();
    expect(request.mock.calls[0][0]).toEqual(['wss://lookup.example/']);
  });

  // An event pointer without hints (a `note1…`, a bare id, `eventStore.event(id)`)
  // used to ask no relay at all: the event loaders had no extra relays, so
  // only the IDB cache was consulted.
  it('eventLoader asks the lookup relays for an id without hints', async () => {
    lookupRelays = [];
    const { eventLoader } = await import('$lib/loaders/base.js');
    lookupRelays = ['wss://lookup.example/'];
    indexerRelays = ['wss://indexer.example/'];

    const sub = eventLoader({ id: 'ef'.repeat(32) }).subscribe();
    await flushBuffer();
    sub.unsubscribe();

    expect(request).toHaveBeenCalled();
    // Content lookup relays only: indexers carry profiles and relay lists
    expect(request.mock.calls.map((c) => c[0]).flat()).toEqual(['wss://lookup.example/']);
  });

  it('eventStore.event(id) on a cold store asks the lookup relays', async () => {
    await import('$lib/loaders/base.js');
    lookupRelays = ['wss://lookup.example/'];

    const sub = eventStore.event('0a'.repeat(32)).subscribe();
    await flushBuffer();
    sub.unsubscribe();

    expect(request.mock.calls.map((c) => c[0]).flat()).toContain('wss://lookup.example/');
  });

  it('does not ask a hinted relay twice when it is also a lookup relay', async () => {
    const { eventLoader } = await import('$lib/loaders/base.js');
    lookupRelays = ['wss://lookup.example/', 'wss://other.example/'];

    const sub = eventLoader({ id: '1b'.repeat(32), relays: ['wss://lookup.example/'] }).subscribe();
    await flushBuffer();
    sub.unsubscribe();

    const asked = request.mock.calls.map((c) => c[0]).flat();
    expect(asked.filter((r) => r === 'wss://lookup.example/')).toHaveLength(1);
    expect(asked).toContain('wss://other.example/');
  });

  it('the store fallback shares one in-flight request with the standalone event loader', async () => {
    const { eventLoader } = await import('$lib/loaders/base.js');
    lookupRelays = ['wss://lookup.example/'];
    const id = '2c'.repeat(32);

    const a = eventLoader({ id }).subscribe();
    const b = eventStore.event(id).subscribe();
    await flushBuffer();
    a.unsubscribe();
    b.unsubscribe();

    const forId = request.mock.calls.filter((c) => JSON.stringify(c[1]).includes(id));
    expect(forId).toHaveLength(1);
  });

  // Profiles and other replaceables must not wait behind the content relays:
  // indexers are asked in the same stage as the lookup relays.
  it('address lookups ask indexers and lookup relays together', async () => {
    const { addressLoader } = await import('$lib/loaders/base.js');
    lookupRelays = ['wss://lookup.example/'];
    indexerRelays = ['wss://indexer.example/'];

    const sub = eventStore.replaceable({ kind: 0, pubkey: '3d'.repeat(32) }).subscribe();
    await flushBuffer();
    sub.unsubscribe();
    void addressLoader;

    const call = request.mock.calls.find((c) => JSON.stringify(c[1]).includes('3d'.repeat(32)));
    expect(call?.[0]).toEqual(['wss://indexer.example/', 'wss://lookup.example/']);
  });
});
