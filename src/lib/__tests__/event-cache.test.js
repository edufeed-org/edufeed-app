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
    globalThis.indexedDB = new FDBFactory();
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

    const addSpy = vi.spyOn(nostrIDB, 'add');

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

    const calledKinds = addSpy.mock.calls.map((c) => c[0].kind);
    expect(calledKinds).toContain(0);
    expect(calledKinds).not.toContain(7);
  });
});

describe('event-cache read / count / clear', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = new FDBFactory();
    vi.resetModules();
  });

  it('cacheRequest returns previously persisted events matching the filter', async () => {
    const { dbReady, nostrIDB, cacheRequest } = await import('$lib/stores/event-cache.svelte.js');
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
    const { cacheRequest, nostrIDB } = await import('$lib/stores/event-cache.svelte.js');
    vi.spyOn(nostrIDB, 'query').mockRejectedValueOnce(new Error('boom'));

    const result = await cacheRequest([{ kinds: [0] }]);
    expect(result).toEqual([]);
  });

  it('count returns the total number of events in IDB', async () => {
    const { dbReady, nostrIDB, count } = await import('$lib/stores/event-cache.svelte.js');
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
    const { dbReady, nostrIDB, clear, count } = await import('$lib/stores/event-cache.svelte.js');
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

describe('warmIdentity', () => {
  beforeEach(async () => {
    mockEventStore = new EventStore();
    mockEventStore.verifyEvent = () => true;
    const FDBFactory = (await import('fake-indexeddb/lib/FDBFactory')).default;
    globalThis.indexedDB = new FDBFactory();
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
    const { dbReady, nostrIDB, warmIdentity } = await import('$lib/stores/event-cache.svelte.js');
    await dbReady;

    const me = 'm'.repeat(64);
    const friend = 'f'.repeat(64);
    const makeEvent = (kind, id, pubkey = me, tags = []) => ({
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
