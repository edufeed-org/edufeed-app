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
