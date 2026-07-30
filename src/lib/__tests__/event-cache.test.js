/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { EventStore } from 'applesauce-core';
import { isCacheableKind } from '$lib/stores/event-cache.svelte.js';

describe('isCacheableKind', () => {
  it('returns true for identity kinds', () => {
    [0, 3, 10002, 30002, 30000].forEach((k) => expect(isCacheableKind(k)).toBe(true));
  });

  it('returns true for NIP-09 deletion events', () => {
    expect(isCacheableKind(5)).toBe(true);
  });

  it('returns true for content kinds', () => {
    [10222, 30023, 30142, 31922, 31923, 31924].forEach((k) =>
      expect(isCacheableKind(k)).toBe(true)
    );
  });

  it('returns false for social / high-churn kinds', () => {
    [1, 7, 8, 9, 11, 1111, 9734, 9735, 31925].forEach((k) =>
      expect(isCacheableKind(k)).toBe(false)
    );
  });

  it('returns false for unknown kinds', () => {
    expect(isCacheableKind(99999)).toBe(false);
  });
});

// We'll initialize the cache store against a shared mock eventStore.
// Because event-cache.svelte.js imports the real eventStore singleton,
// we use vi.mock to replace it with a fresh instance per test.
/** @type {EventStore} */
let mockEventStore;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => {
  return {
    get eventStore() {
      return mockEventStore;
    },
    pool: {}
  };
});

describe('event-cache initialization', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    // Bypass signature verification — synthetic events in this test
    // have fake ids/sigs and would fail nostr-tools' verifyEvent.
    mockEventStore.verifyEvent = () => true;
    // Reset fake-indexeddb between tests
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = /** @type {IDBFactory} */ (/** @type {unknown} */ (new FDBFactory()));
    // Reset module cache so event-cache.svelte.js re-runs with the fresh
    // mockEventStore. Without this, persistEventsToCache stays wired to
    // the EventStore from a previous test.
    vi.resetModules();
  });

  it('dbReady resolves once NostrIDB is started', async () => {
    const { dbReady } = await import('$lib/stores/event-cache.svelte.js');
    await expect(dbReady).resolves.toBeUndefined();
  });

  it('persists cacheable kinds and skips non-cacheable kinds', async () => {
    const { dbReady, nostrIDB } = await import('$lib/stores/event-cache.svelte.js');
    await dbReady;

    const addSpy = vi.spyOn(/** @type {NonNullable<typeof nostrIDB>} */ (nostrIDB), 'add');

    // Push a cacheable event (kind 0) and a non-cacheable (kind 7).
    const profile = {
      id: 'a'.repeat(64),
      kind: 0,
      pubkey: 'p'.repeat(64),
      created_at: 1000,
      tags: [],
      content: '{"name":"Alice"}',
      sig: 's'.repeat(128)
    };
    const reaction = { ...profile, id: 'b'.repeat(64), kind: 7, content: '+' };

    mockEventStore.add(profile);
    mockEventStore.add(reaction);

    // persistEventsToCache batches; wait for the batch window to flush.
    await new Promise((r) => setTimeout(r, 2500));

    const calledKinds = addSpy.mock.calls.map(
      (/** @type {[import('nostr-tools').Event]} */ c) => c[0].kind
    );
    expect(calledKinds).toContain(0);
    expect(calledKinds).not.toContain(7);
  });
});

describe('event-cache read / count / clear', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = /** @type {IDBFactory} */ (/** @type {unknown} */ (new FDBFactory()));
    vi.resetModules();
  });

  it('cacheRequest returns previously persisted events matching the filter', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      cacheRequest
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const profile = {
      id: 'c'.repeat(64),
      kind: 0,
      pubkey: 'p'.repeat(64),
      created_at: 1000,
      tags: [],
      content: '{"name":"Bob"}',
      sig: 's'.repeat(128)
    };
    await nostrIDB.add(profile);

    const result = await cacheRequest([{ kinds: [0], authors: ['p'.repeat(64)] }]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c'.repeat(64));
  });

  it('cacheRequest returns [] when IDB throws (graceful degradation)', async () => {
    const { cacheRequest, nostrIDB: _nostrIDB } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    vi.spyOn(nostrIDB, 'query').mockRejectedValueOnce(new Error('boom'));

    const result = await cacheRequest([{ kinds: [0] }]);
    expect(result).toEqual([]);
  });

  it('count returns the total number of events in IDB', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      count
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    await nostrIDB.add({
      id: 'd'.repeat(64),
      kind: 0,
      pubkey: 'p'.repeat(64),
      created_at: 1000,
      tags: [],
      content: '{}',
      sig: 's'.repeat(128)
    });

    expect(await count()).toBeGreaterThanOrEqual(1);
  });

  it('clear empties the database', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      clear,
      count
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    await nostrIDB.add({
      id: 'e'.repeat(64),
      kind: 0,
      pubkey: 'p'.repeat(64),
      created_at: 1000,
      tags: [],
      content: '{}',
      sig: 's'.repeat(128)
    });
    expect(await count()).toBeGreaterThanOrEqual(1);

    await clear();
    expect(await count()).toBe(0);
  });
});

describe('hydrateDeletions', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = /** @type {IDBFactory} */ (/** @type {unknown} */ (new FDBFactory()));
    vi.resetModules();
  });

  it('replays a cached regular-event deletion so the deleted event stays filtered', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      hydrateDeletions
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const pubkey = 'a'.repeat(64);
    const deletedId = '1'.repeat(64);
    const content = {
      id: deletedId,
      kind: 1,
      pubkey,
      created_at: 1000,
      tags: [],
      content: 'hello',
      sig: 's'.repeat(128)
    };
    const deletion = {
      id: 'd'.repeat(64),
      kind: 5,
      pubkey,
      created_at: 1001,
      tags: [['e', deletedId]],
      content: '',
      sig: 's'.repeat(128)
    };
    await nostrIDB.add(deletion);
    await nostrIDB.writeQueue?.flush();

    // Replay the cached deletion into the (empty) store, then simulate a content
    // loader pulling the deleted event back from cache.
    await hydrateDeletions();
    mockEventStore.add(content);

    expect(mockEventStore.getEvent(deletedId)).toBeUndefined();
  });

  it('replays a cached addressable deletion so the deleted resource stays filtered', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      hydrateDeletions
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const pubkey = 'a'.repeat(64);
    const content = {
      id: '2'.repeat(64),
      kind: 30142,
      pubkey,
      created_at: 1000,
      tags: [['d', 'resource-abc']],
      content: '',
      sig: 's'.repeat(128)
    };
    const deletion = {
      id: 'e'.repeat(64),
      kind: 5,
      pubkey,
      created_at: 1001,
      tags: [['a', `30142:${pubkey}:resource-abc`]],
      content: '',
      sig: 's'.repeat(128)
    };
    await nostrIDB.add(deletion);
    await nostrIDB.writeQueue?.flush();

    await hydrateDeletions();
    mockEventStore.add(content);

    expect(mockEventStore.getReplaceable(30142, pubkey, 'resource-abc')).toBeUndefined();
  });

  it('is a graceful no-op when there are no cached deletions', async () => {
    const { dbReady, hydrateDeletions } = await import('$lib/stores/event-cache.svelte.js');
    await dbReady;
    await expect(hydrateDeletions()).resolves.toBeUndefined();
  });
});

describe('cacheDeletion', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = /** @type {IDBFactory} */ (/** @type {unknown} */ (new FDBFactory()));
    vi.resetModules();
  });

  it('persists a deletion to IDB so it survives a reload', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      cacheDeletion
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const pubkey = 'a'.repeat(64);
    const deletion = {
      id: 'd'.repeat(64),
      kind: 5,
      pubkey,
      created_at: 1001,
      tags: [['a', `10222:${pubkey}:`]],
      content: '',
      sig: 's'.repeat(128)
    };

    await cacheDeletion(deletion);
    await nostrIDB.writeQueue?.flush?.();

    const cached = await nostrIDB.query([{ kinds: [5] }]);
    expect(cached.map((/** @type {any} */ e) => e.id)).toContain(deletion.id);
  });

  it('is the write path hydrateDeletions replays on the next boot to keep the original filtered', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      cacheDeletion,
      hydrateDeletions
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const pubkey = 'a'.repeat(64);
    // A replaceable community definition (kind 10222 → empty d identifier).
    const community = {
      id: 'c'.repeat(64),
      kind: 10222,
      pubkey,
      created_at: 1000,
      tags: [],
      content: '',
      sig: 's'.repeat(128)
    };
    const deletion = {
      id: 'e'.repeat(64),
      kind: 5,
      pubkey,
      created_at: 1001,
      tags: [['a', `10222:${pubkey}:`]],
      content: '',
      sig: 's'.repeat(128)
    };

    // Write side: what the deletion helpers do at delete time.
    await cacheDeletion(deletion);
    await nostrIDB.writeQueue?.flush?.();

    // Read side on next boot: replay cached deletions, then a loader pulls the
    // now-deleted community back from cache.
    await hydrateDeletions();
    mockEventStore.add(community);

    expect(mockEventStore.getReplaceable(10222, pubkey, '')).toBeUndefined();
  });

  it('persists a deletion with no recognisable target (kind 5 is always cacheable)', async () => {
    const { dbReady, cacheDeletion } = await import('$lib/stores/event-cache.svelte.js');
    await dbReady;

    // Even a deletion object with no recognisable target is stored — kind 5 is
    // correctness-critical and cheap, we don't parse tags to decide.
    await expect(
      cacheDeletion({
        id: 'f'.repeat(64),
        kind: 5,
        pubkey: 'a'.repeat(64),
        created_at: 1,
        tags: [],
        content: '',
        sig: 's'.repeat(128)
      })
    ).resolves.toBeUndefined();
  });
});

describe('warmIdentity', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = /** @type {IDBFactory} */ (/** @type {unknown} */ (new FDBFactory()));
    vi.resetModules();
  });

  it('is a no-op when no active user is provided', async () => {
    const { dbReady, warmIdentity } = await import('$lib/stores/event-cache.svelte.js');
    await dbReady;
    const addSpy = vi.spyOn(mockEventStore, 'add');
    await warmIdentity({ activeUserPubkey: null });
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('loads own kind 3 + 10002 + 30002 + 30000 into the event store', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      warmIdentity
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const me = 'm'.repeat(64);
    const friend = 'f'.repeat(64);
    const makeEvent = (
      /** @type {number} */ kind,
      /** @type {string} */ id,
      /** @type {string} */ pubkey = me,
      /** @type {string[][]} */ tags = []
    ) => ({
      id: id.padEnd(64, '0'),
      kind,
      pubkey,
      created_at: 1000,
      tags,
      content: kind === 0 ? '{"name":"Me"}' : '',
      sig: 's'.repeat(128)
    });

    // Seed own identity events
    await nostrIDB.add(makeEvent(3, '1', me, [['p', friend]]));
    await nostrIDB.add(makeEvent(10002, '2'));
    // Seed friend's profile
    await nostrIDB.add(makeEvent(0, '3', friend));

    const addSpy = vi.spyOn(mockEventStore, 'add');
    await warmIdentity({ activeUserPubkey: me });

    const addedKinds = addSpy.mock.calls.map((c) => c[0].kind).sort();
    expect(addedKinds).toContain(3);
    expect(addedKinds).toContain(10002);
    // Friend's profile should be loaded because they're p-tagged in kind 3
    expect(addSpy.mock.calls.some((c) => c[0].pubkey === friend && c[0].kind === 0)).toBe(true);
  });
});

describe('uncacheEvent (#64)', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = /** @type {IDBFactory} */ (/** @type {unknown} */ (new FDBFactory()));
    vi.resetModules();
  });

  /**
   * @param {Partial<import('nostr-tools').Event>} [overrides]
   * @returns {import('nostr-tools').Event}
   */
  const addressable = (overrides = {}) =>
    /** @type {any} */ ({
      id: '1'.repeat(64),
      kind: 31923,
      // Hex, unlike the fixtures above: nostr-idb runs validateEvent on flush
      // and silently drops a non-hex pubkey, so a non-hex fixture never
      // reaches IDB and every assertion below would pass vacuously.
      pubkey: 'b'.repeat(64),
      created_at: 1000,
      tags: [['d', 'event-1']],
      content: '',
      sig: 'f'.repeat(128),
      ...overrides
    });

  it('removes an addressable event from IDB', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      uncacheEvent,
      cacheRequest
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const phantom = addressable();
    await nostrIDB.add(phantom);
    await nostrIDB.writeQueue?.flush?.();
    expect(await cacheRequest([{ kinds: [31923] }])).toHaveLength(1);

    await uncacheEvent(phantom);

    expect(await cacheRequest([{ kinds: [31923] }])).toHaveLength(0);
  });

  it('does NOT delete a newer version that legitimately holds the address', async () => {
    // nostr-idb keys addressable events by `kind:pubkey:d`, so a blind delete
    // by address would drop whatever occupies it — turning the removal of a
    // failed publish into cache loss for the version that replaced it.
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      uncacheEvent,
      cacheRequest
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const phantom = addressable({ id: '1'.repeat(64), created_at: 1000 });
    const newer = addressable({ id: '2'.repeat(64), created_at: 1001 });
    await nostrIDB.add(newer);
    await nostrIDB.writeQueue?.flush?.();

    await uncacheEvent(phantom);

    const remaining = await cacheRequest([{ kinds: [31923] }]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('2'.repeat(64));
  });

  it('removes a non-addressable event, which is keyed by id', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      uncacheEvent,
      cacheRequest
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const deletion = addressable({ id: '3'.repeat(64), kind: 5, tags: [] });
    await nostrIDB.add(deletion);
    await nostrIDB.writeQueue?.flush?.();
    expect(await cacheRequest([{ kinds: [5] }])).toHaveLength(1);

    await uncacheEvent(deletion);

    expect(await cacheRequest([{ kinds: [5] }])).toHaveLength(0);
  });

  it('degrades to a no-op when IDB throws', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      uncacheEvent
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;
    vi.spyOn(nostrIDB, 'event').mockRejectedValueOnce(new Error('boom'));

    await expect(uncacheEvent(addressable())).resolves.toBeUndefined();
  });

  it('does not persist an event the store dropped before the batch flushed', async () => {
    // The write pipeline buffers, so an event can leave the EventStore between
    // insert$ and the write. Persisting it then puts an event in IDB that the
    // app no longer holds — and at an addressable key, that OVERWRITES the
    // last good version.
    const { dbReady, nostrIDB: _nostrIDB } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const addSpy = vi.spyOn(nostrIDB, 'add');
    const phantom = addressable({ kind: 31923 });
    // A second event in the same batch that is NOT removed. Waiting for this
    // one proves the buffer actually fired — sleeping past the window instead
    // would let a starved timer pass the assertion vacuously.
    const keeper = addressable({
      id: '9'.repeat(64),
      kind: 31923,
      tags: [['d', 'keeper']]
    });

    mockEventStore.add(phantom);
    mockEventStore.add(keeper);
    mockEventStore.remove(phantom);

    await vi.waitFor(
      () => expect(addSpy.mock.calls.some((c) => c[0].id === keeper.id)).toBe(true),
      { timeout: 20_000, interval: 50 }
    );

    expect(addSpy.mock.calls.some((c) => c[0].id === phantom.id)).toBe(false);
  });
});

describe('failed-publish orderings against IDB (#64)', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = /** @type {IDBFactory} */ (/** @type {unknown} */ (new FDBFactory()));
    vi.resetModules();
  });

  const PK = 'b'.repeat(64);
  const UID = `30142:${PK}:res-1`;
  /**
   * @param {string} idChar
   * @param {number} created_at
   */
  const version = (idChar, created_at) =>
    /** @type {any} */ ({
      id: idChar.repeat(64),
      kind: 30142,
      pubkey: PK,
      created_at,
      tags: [['d', 'res-1']],
      content: '',
      sig: 'f'.repeat(128)
    });

  /**
   * Wait until the batched write pipeline has landed `expectedId` at the
   * address. Polled rather than slept: the rxjs buffer fires on a 1000ms
   * timer, and under a loaded full-suite run that timer can be starved well
   * past any fixed sleep — which would make these tests fail by load rather
   * than by behaviour.
   * @param {any} nostrIDB
   * @param {string} expectedId
   */
  const waitForAddress = (nostrIDB, expectedId) =>
    vi.waitFor(
      async () => {
        await nostrIDB.writeQueue?.flush?.();
        expect((await nostrIDB.event(UID))?.id).toBe(expectedId);
      },
      { timeout: 20_000, interval: 50 }
    );

  it('LATE failure: the phantom overwrites the good version, and the restore puts it back', async () => {
    // This is the DEFAULT ordering — failure is detected after a 5000ms
    // publish timeout while the cache batches at 1000ms. Deleting the phantom
    // on its own would leave the address EMPTY, which is why publish-service
    // captures the previous version before the optimistic add and re-adds it.
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      uncacheEvent
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const good = version('1', 1000);
    const phantom = version('2', 1001);

    mockEventStore.add(good);
    await waitForAddress(nostrIDB, good.id);

    // publish-service captures this BEFORE the optimistic add — the only
    // moment it is still reachable.
    const previous = mockEventStore.getReplaceable(30142, PK, 'res-1');
    expect(previous?.id).toBe(good.id);

    // nostr-idb keys by kind:pubkey:d, so the good version is GONE, not shadowed.
    mockEventStore.add(phantom);
    await waitForAddress(nostrIDB, phantom.id);

    // ...the failure path, in publish-service's order.
    mockEventStore.remove(phantom);
    expect(mockEventStore.getReplaceable(30142, PK, 'res-1')).toBeUndefined();
    await uncacheEvent(phantom);
    expect(await nostrIDB.event(UID)).toBeUndefined();

    mockEventStore.add(/** @type {any} */ (previous));
    await waitForAddress(nostrIDB, good.id);

    expect(mockEventStore.getReplaceable(30142, PK, 'res-1')?.id).toBe(good.id);
  });

  it('an event removed inside the batch window is never written (not reachable via a failed publish)', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      uncacheEvent
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const good = version('1', 1000);
    const phantom = version('2', 1001);

    mockEventStore.add(good);
    await waitForAddress(nostrIDB, good.id);

    const previous = mockEventStore.getReplaceable(30142, PK, 'res-1');

    // Spy AFTER the seed so the only calls observed belong to the second batch.
    const addSpy = vi.spyOn(nostrIDB, 'add');

    // Removal inside the batch window: uncacheEvent finds nothing to delete and
    // the flush-time hasEvent guard is what keeps the event out of IDB.
    //
    // A failed publish CANNOT produce this ordering — TestOER measured the
    // fastest possible failure at 1006-1015ms against a 1000ms batch — so this
    // pins the guard's general invariant (superseded versions, NIP-09
    // deletions), not the #64 failure path.
    mockEventStore.add(phantom);
    mockEventStore.remove(phantom);
    await uncacheEvent(phantom);
    mockEventStore.add(/** @type {any} */ (previous));

    // Wait for the batch to actually run rather than sleeping past it — if the
    // buffer were merely starved, asserting "no phantom write" would pass
    // vacuously.
    await vi.waitFor(() => expect(addSpy.mock.calls.some((c) => c[0].id === good.id)).toBe(true), {
      timeout: 20_000,
      interval: 50
    });

    expect(addSpy.mock.calls.some((c) => c[0].id === phantom.id)).toBe(false);
    await waitForAddress(nostrIDB, good.id);
  });

  it('restoring BEFORE the un-cache would be silently rejected', async () => {
    // Pins why the ordering in publish-service is load-bearing rather than
    // incidental: nostr-idb only writes a replaceable event when it is newer
    // than the entry at its address.
    const { dbReady, nostrIDB: _nostrIDB } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const good = version('1', 1000);
    const phantom = version('2', 1001);

    await nostrIDB.add(phantom);
    await nostrIDB.writeQueue?.flush?.();
    await nostrIDB.add(good);
    await nostrIDB.writeQueue?.flush?.();

    expect((await nostrIDB.event(UID))?.id).toBe(phantom.id);
  });
});

describe('recacheEvent (#64, from-cache restore)', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = /** @type {IDBFactory} */ (/** @type {unknown} */ (new FDBFactory()));
    vi.resetModules();
  });

  const PK = 'b'.repeat(64);
  const UID = `30142:${PK}:res-1`;
  const FROM_CACHE = Symbol.for('from-cache');

  /**
   * @param {string} idChar
   * @param {number} created_at
   */
  const version = (idChar, created_at) =>
    /** @type {any} */ ({
      id: idChar.repeat(64),
      kind: 30142,
      pubkey: PK,
      created_at,
      tags: [['d', 'res-1']],
      content: '',
      sig: 'f'.repeat(128)
    });

  it('the insert$ pipeline DROPS an event marked from-cache — which is the bug', async () => {
    // applesauce's persistEventsToCache filters on !isFromCache. A predecessor
    // that reached the app through cacheRequest carries the marker, so re-adding
    // it to the EventStore restores memory and silently never reaches IDB.
    const { dbReady, nostrIDB: _nostrIDB } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const addSpy = vi.spyOn(nostrIDB, 'add');
    const cached = version('1', 1000);
    Reflect.set(cached, FROM_CACHE, true);
    const keeper = version('9', 1000);
    keeper.tags = [['d', 'keeper']];

    mockEventStore.add(cached);
    mockEventStore.add(keeper);

    // Wait for the batch to actually run, so the absence below is not vacuous.
    await vi.waitFor(
      () => expect(addSpy.mock.calls.some((c) => c[0].id === keeper.id)).toBe(true),
      { timeout: 20_000, interval: 50 }
    );

    expect(addSpy.mock.calls.some((c) => c[0].id === cached.id)).toBe(false);
  });

  it('object spread does NOT strip the marker', async () => {
    // Ruling out the tempting one-liner: spread copies own enumerable symbol
    // properties, so {...previous} is still from-cache.
    const { isFromCache } = await import('applesauce-core/helpers/event');
    const cached = version('1', 1000);
    Reflect.set(cached, FROM_CACHE, true);

    expect(isFromCache({ ...cached })).toBe(true);
  });

  it('writes a from-cache event to IDB anyway', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      recacheEvent
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const cached = version('1', 1000);
    Reflect.set(cached, FROM_CACHE, true);

    await recacheEvent(cached);

    expect((await nostrIDB.event(UID))?.id).toBe(cached.id);
  });

  it('restores the predecessor at an address the phantom had taken', async () => {
    // The full failure sequence, with a from-cache predecessor: this is the
    // path a user takes after any page reload.
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      uncacheEvent,
      recacheEvent
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const good = version('1', 1000);
    Reflect.set(good, FROM_CACHE, true);
    const phantom = version('2', 1001);

    await nostrIDB.add(good);
    await nostrIDB.writeQueue?.flush?.();
    await nostrIDB.add(phantom);
    await nostrIDB.writeQueue?.flush?.();
    expect((await nostrIDB.event(UID))?.id).toBe(phantom.id);

    await uncacheEvent(phantom);
    expect(await nostrIDB.event(UID)).toBeUndefined();

    await recacheEvent(good);
    expect((await nostrIDB.event(UID))?.id).toBe(good.id);
  });

  it('refuses a kind the cache deliberately does not persist', async () => {
    // A direct write must not smuggle past the CACHEABLE_KINDS filter that the
    // insert$ writer applies.
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      recacheEvent
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;

    const reaction = version('3', 1000);
    reaction.kind = 7;
    reaction.tags = [];

    await recacheEvent(reaction);

    expect(await nostrIDB.event(reaction.id)).toBeUndefined();
  });

  it('degrades to a no-op when IDB throws', async () => {
    const {
      dbReady,
      nostrIDB: _nostrIDB,
      recacheEvent
    } = await import('$lib/stores/event-cache.svelte.js');
    const nostrIDB = /** @type {NonNullable<typeof _nostrIDB>} */ (_nostrIDB);
    await dbReady;
    vi.spyOn(nostrIDB, 'add').mockRejectedValueOnce(new Error('boom'));

    await expect(recacheEvent(version('1', 1000))).resolves.toBeUndefined();
  });
});
