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

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEventLoaderLookupRelays: () => lookupRelays,
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
});
