/**
 * The event/address loaders ask each stage's relays together and move on
 * when the stage completes or after LOADER_STAGE_TIMEOUT_MS. One relay that
 * never answers held every miss for the full stage (5.2 s measured with
 * nos.lol in the list). Lookups BY ID now leave out the relays the liveness
 * tracker has parked; address/replaceable lookups (profiles, kind 10002 /
 * 10050 whose "absent" verdict write paths act on) never do.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EMPTY, Subject } from 'rxjs';

const DEAD = 'wss://dead.example/';
const OK = 'wss://ok.example/';

/** @type {import('vitest').Mock} */
const request = vi.fn(() => EMPTY);
vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  return {
    pool: {
      request: (/** @type {any[]} */ ...args) => request(...args),
      // A relay that never opens (its address swallows the connection)
      relay: (/** @type {string} */ url) => ({ url, connected: false, open$: new Subject() })
    },
    eventStore: new EventStore()
  };
});
vi.mock('$lib/stores/event-cache.svelte.js', () => ({ cacheRequest: vi.fn(async () => []) }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEventLoaderLookupRelays: () => [],
  getAllLookupRelays: () => []
}));
/** Relays the tracker has seen connect; empty = this device looks offline. */
let online = [OK];
vi.mock('$lib/stores/relay-liveness.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    relayLiveness: {
      recordFailure: vi.fn(),
      filter: (/** @type {string[]} */ relays) => relays.filter((r) => r !== DEAD),
      get online() {
        return online;
      }
    }
  };
});

const { loaderRequest, eventLoader, addressLoader } = await import('$lib/loaders/base.js');
const { relayLiveness } = /** @type {any} */ (await import('$lib/stores/relay-liveness.js'));

/** Wait past the loaders' request buffers. */
const flush = () => new Promise((r) => setTimeout(r, 300));

describe('loader requests skip parked relays for lookups by id only', () => {
  beforeEach(() => {
    request.mockClear();
    online = [OK];
  });

  it('leaves parked relays out of an ids-only request', () => {
    loaderRequest([DEAD, OK], [{ ids: ['a'.repeat(64)] }]).subscribe();
    expect(request).toHaveBeenCalledWith([OK], [{ ids: ['a'.repeat(64)] }]);
  });

  it('keeps every relay for address, author or kind filters', () => {
    const filters = [{ kinds: [10002], authors: ['b'.repeat(64)] }];
    loaderRequest([DEAD, OK], filters).subscribe();
    expect(request).toHaveBeenCalledWith([DEAD, OK], filters);
  });

  // The event loader asks every hint relay in a request of its own, so a
  // parked hint relay arrives alone: it is skipped while the network works …
  it('skips a lone parked relay while other relays are online', () => {
    loaderRequest([DEAD], [{ ids: ['c'.repeat(64)] }]).subscribe();
    expect(request).not.toHaveBeenCalled();
  });

  // … but with nothing online (offline device, network just back) asking the
  // parked relay beats asking nobody.
  it('asks a lone parked relay when no relay is online', () => {
    online = [];
    loaderRequest([DEAD], [{ ids: ['c'.repeat(64)] }]).subscribe();
    expect(request).toHaveBeenCalledWith([DEAD], [{ ids: ['c'.repeat(64)] }]);
  });

  it('eventLoader goes through it; addressLoader keeps the parked relay', async () => {
    const a = eventLoader({ id: 'd'.repeat(64), relays: [DEAD, OK] }).subscribe();
    const b = addressLoader({ kind: 0, pubkey: 'e'.repeat(64), relays: [DEAD, OK] }).subscribe();
    await flush();
    a.unsubscribe();
    b.unsubscribe();

    const asked = (/** @type {string} */ needle) =>
      request.mock.calls
        .filter((c) => JSON.stringify(c[1]).includes(needle))
        .map((c) => c[0])
        .flat();
    expect(asked('d'.repeat(64))).toEqual([OK]);
    expect(asked('e'.repeat(64)).sort()).toEqual([DEAD, OK]);
  });

  // A silent relay never errors, so the tracker would never park it: an id
  // lookup arms the connect deadline for every relay it asks.
  it('records a relay asked by id that has not opened 15 s later', async () => {
    vi.useFakeTimers();
    try {
      relayLiveness.recordFailure.mockClear();
      loaderRequest(['wss://silent.example/'], [{ ids: ['f'.repeat(64)] }]).subscribe();
      loaderRequest(['wss://other.example/'], [{ kinds: [0] }]).subscribe();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(relayLiveness.recordFailure.mock.calls).toEqual([['wss://silent.example/']]);
    } finally {
      vi.useRealTimers();
    }
  });
});
