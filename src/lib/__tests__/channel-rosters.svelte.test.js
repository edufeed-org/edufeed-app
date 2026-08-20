// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// useChannelRosters: one batched 39001+39002 request per RELAY over a set of
// channel pointers, fed THROUGH the eventStore and read back from it. The
// value-stable-key + 300ms debounce shape (host-unread.svelte.js) is preserved;
// the roster records now come from eventStore.model(TimelineModel), so a
// remounted/duplicate reader gets the already-stored roster with no reliance on
// relay replay, and a relay that answers nothing can no longer clobber a real
// roster with an empty Set (laoc 2026-08-20 flicker fix).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const RELAY = 'wss://groups.example/';
const OTHER_RELAY = 'wss://other.example/';
const RELAY_PK = '9'.repeat(64); // relay self-key (author of 39001/39002)

const ADMIN = 'a'.repeat(64);
const MEMBER_1 = 'b'.repeat(64);
const MEMBER_2 = 'c'.repeat(64);

const holders = vi.hoisted(() => ({
  requestCalls: /** @type {any[]} */ ([]),
  /** @type {Record<string, any[]>} */
  fixturesByRelay: {},
  errorRelays: /** @type {Set<string>} */ (new Set()),
  /** @type {any} */ eventStore: null
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  const { of, throwError } = await import('rxjs');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  holders.eventStore = eventStore;
  return {
    eventStore,
    pool: {
      relay: (/** @type {string} */ url) => ({
        request: (/** @type {any} */ filter, /** @type {any} */ opts) => {
          holders.requestCalls.push({ url, filter, opts });
          if (holders.errorRelays.has(url)) return throwError(() => new Error('relay timeout'));
          return of(...(holders.fixturesByRelay[url] ?? []));
        }
      })
    }
  };
});

import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
import { channelKey } from '$lib/groups/community-pointer.js';
import { rosterView } from '$lib/groups/root-roster.js';

let evtSeq = 0;
/** @param {string} id @param {number} [created_at] */
const membersEvent = (id, created_at = 1000) => ({
  kind: 39002,
  pubkey: RELAY_PK,
  created_at,
  id: `mem-${id}-${created_at}-${evtSeq++}`,
  sig: 'x',
  content: '',
  tags: [
    ['d', id],
    ['p', MEMBER_1],
    ['p', MEMBER_2]
  ]
});

/** @param {string} id @param {string[]} [members] @param {number} [created_at] */
const membersEventWith = (id, members, created_at = 1000) => ({
  kind: 39002,
  pubkey: RELAY_PK,
  created_at,
  id: `mem-${id}-${created_at}-${evtSeq++}`,
  sig: 'x',
  content: '',
  tags: [['d', id], ...members.map((p) => ['p', p])]
});

/** @param {string} id */
const adminsEvent = (id) => ({
  kind: 39001,
  pubkey: RELAY_PK,
  created_at: 1000,
  id: `adm-${id}-${evtSeq++}`,
  sig: 'x',
  content: '',
  tags: [
    ['d', id],
    ['p', ADMIN, 'admin']
  ]
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

/** @param {() => Array<{id: string, relay: string}>} getPointers */
function mountHook(getPointers) {
  /** @type {() => any} */
  let getRosters;
  const cleanup = $effect.root(() => {
    getRosters = useChannelRosters(getPointers);
  });
  flushSync();
  return { getRosters, cleanup };
}

describe('useChannelRosters', () => {
  beforeEach(() => {
    holders.requestCalls = [];
    holders.fixturesByRelay = {};
    holders.errorRelays = new Set();
    // Fresh store per test — no roster leaks across cases.
    holders.eventStore?.removeByFilters?.({ kinds: [39001, 39002] });
    holders.eventStore?.database?.clear?.();
  });

  it('batches two pointers on one relay into a single request and resolves rosters', async () => {
    const pointerA = { id: 'general', relay: RELAY };
    const pointerB = { id: 'random', relay: RELAY };
    holders.fixturesByRelay[RELAY] = [
      membersEvent('general'),
      adminsEvent('general'),
      membersEvent('random')
    ];

    let pointers = $state.raw([pointerA, pointerB]);
    const { getRosters, cleanup } = mountHook(() => pointers);
    flushSync();
    await settle();

    expect(holders.requestCalls).toHaveLength(1);
    const { filter, opts } = holders.requestCalls[0];
    expect(filter.kinds.slice().sort()).toEqual([39001, 39002]);
    expect(filter['#d'].slice().sort()).toEqual(['general', 'random']);
    expect(opts).toEqual({ timeout: 8000 });

    const keyGeneral = channelKey(pointerA);
    const keyRandom = channelKey(pointerB);
    const { membersByKey, adminsByKey } = getRosters();
    expect(membersByKey[keyGeneral]).toEqual(new Set([MEMBER_1, MEMBER_2]));
    expect(membersByKey[keyRandom]).toEqual(new Set([MEMBER_1, MEMBER_2]));
    expect(adminsByKey[keyGeneral]).toEqual([{ pubkey: ADMIN, roles: ['admin'] }]);
    expect(adminsByKey[keyRandom]).toBeUndefined();

    cleanup();
  });

  // THE REGRESSION: a second reader must see the roster the store already
  // holds, immediately, WITHOUT the relay replaying it (the settings→members→
  // settings flicker was a fresh REQ coming back empty and being trusted).
  it('a second reader sees the stored roster instantly, with no new relay event', async () => {
    const pointerA = { id: 'general', relay: RELAY };
    holders.fixturesByRelay[RELAY] = [membersEvent('general'), adminsEvent('general')];

    let pointers = $state.raw([pointerA]);
    const first = mountHook(() => pointers);
    flushSync();
    await settle();
    const key = channelKey(pointerA);
    expect(first.getRosters().membersByKey[key]).toEqual(new Set([MEMBER_1, MEMBER_2]));

    // A SECOND, independent reader — and this time the relay answers NOTHING
    // (empty fixtures), exactly like applesauce not replaying to a late REQ.
    holders.fixturesByRelay[RELAY] = [];
    holders.requestCalls = [];
    let pointers2 = $state.raw([{ id: 'general', relay: RELAY }]);
    const second = mountHook(() => pointers2);
    flushSync();
    await settle();

    // It still reads the full roster from the store — not an empty/clobbered one.
    expect(second.getRosters().membersByKey[key]).toEqual(new Set([MEMBER_1, MEMBER_2]));

    first.cleanup();
    second.cleanup();
  });

  it('newest-wins: a newer 39002 replaces an older one', async () => {
    const pointerA = { id: 'general', relay: RELAY };
    holders.fixturesByRelay[RELAY] = [
      membersEventWith('general', [MEMBER_1], 1000),
      membersEventWith('general', [MEMBER_1, MEMBER_2], 2000) // newer
    ];

    let pointers = $state.raw([pointerA]);
    const { getRosters, cleanup } = mountHook(() => pointers);
    flushSync();
    await settle();

    const key = channelKey(pointerA);
    expect(getRosters().membersByKey[key]).toEqual(new Set([MEMBER_1, MEMBER_2]));

    cleanup();
  });

  it('does not re-request when a same-content pointer array gets a fresh identity', async () => {
    const pointerA = { id: 'general', relay: RELAY };
    holders.fixturesByRelay[RELAY] = [membersEvent('general')];

    let pointers = $state.raw([pointerA]);
    const { cleanup } = mountHook(() => pointers);
    flushSync();
    await settle();
    expect(holders.requestCalls).toHaveLength(1);

    pointers = [{ id: 'general', relay: RELAY }];
    flushSync();
    await settle();
    expect(holders.requestCalls).toHaveLength(1);

    cleanup();
  });

  it('refresh() fires a new request', async () => {
    const pointerA = { id: 'general', relay: RELAY };
    holders.fixturesByRelay[RELAY] = [membersEvent('general')];

    let pointers = $state.raw([pointerA]);
    const { getRosters, cleanup } = mountHook(() => pointers);
    flushSync();
    await settle();
    expect(holders.requestCalls).toHaveLength(1);

    getRosters().refresh();
    flushSync();
    await settle();
    expect(holders.requestCalls.length).toBeGreaterThanOrEqual(2);

    cleanup();
  });

  it('groups pointers on different relays into separate requests', async () => {
    const pointerA = { id: 'general', relay: RELAY };
    const pointerB = { id: 'other-channel', relay: OTHER_RELAY };
    holders.fixturesByRelay[RELAY] = [membersEvent('general')];
    holders.fixturesByRelay[OTHER_RELAY] = [membersEvent('other-channel')];

    let pointers = $state.raw([pointerA, pointerB]);
    const { getRosters, cleanup } = mountHook(() => pointers);
    flushSync();
    await settle();

    expect(holders.requestCalls).toHaveLength(2);
    const urls = holders.requestCalls.map((c) => c.url).sort();
    expect(urls).toEqual([OTHER_RELAY, RELAY].sort());

    const { membersByKey } = getRosters();
    expect(membersByKey[channelKey(pointerA)]).toEqual(new Set([MEMBER_1, MEMBER_2]));
    expect(membersByKey[channelKey(pointerB)]).toEqual(new Set([MEMBER_1, MEMBER_2]));

    cleanup();
  });

  // Dead-relay spinner fix, restated for the eventStore model: a relay that
  // finishes (EOSE with no roster, or timeout) without delivering 39001/39002
  // must flip isLoading false via fetchedKeys — WITHOUT writing an empty Set
  // into membersByKey (that clobber was the flicker bug).
  describe('fetched-but-empty terminates isLoading without clobbering', () => {
    it('a relay that completes with zero matching events marks the key fetched; rosterView is not loading', async () => {
      const pointerA = { id: 'general', relay: RELAY };
      // No fixture registered for RELAY — of() emits nothing and completes.
      let pointers = $state.raw([pointerA]);
      const { getRosters, cleanup } = mountHook(() => pointers);
      flushSync();
      await settle();

      const key = channelKey(pointerA);
      const { membersByKey, adminsByKey, fetchedKeys } = getRosters();
      // No fabricated empty Set — the store holds nothing for this key.
      expect(membersByKey[key]).toBeUndefined();
      expect(fetchedKeys.has(key)).toBe(true);

      const view = rosterView(pointerA, membersByKey, adminsByKey, fetchedKeys);
      expect(view.isLoading).toBe(false);
      expect(view.isMember(MEMBER_1)).toBe(false);

      cleanup();
    });

    it('a relay that errors (dead/unresponsive) also marks the key fetched', async () => {
      const pointerA = { id: 'general', relay: RELAY };
      holders.errorRelays = new Set([RELAY]);

      let pointers = $state.raw([pointerA]);
      const { getRosters, cleanup } = mountHook(() => pointers);
      flushSync();
      await settle();

      const key = channelKey(pointerA);
      const { membersByKey, adminsByKey, fetchedKeys } = getRosters();
      expect(fetchedKeys.has(key)).toBe(true);
      expect(rosterView(pointerA, membersByKey, adminsByKey, fetchedKeys).isLoading).toBe(false);

      cleanup();
    });

    it('a real roster is never overwritten by a later empty fetch (stale-while-revalidate)', async () => {
      const pointerA = { id: 'general', relay: RELAY };
      holders.fixturesByRelay[RELAY] = [membersEvent('general')];

      let pointers = $state.raw([pointerA]);
      const { getRosters, cleanup } = mountHook(() => pointers);
      flushSync();
      await settle();
      const key = channelKey(pointerA);
      expect(getRosters().membersByKey[key]).toEqual(new Set([MEMBER_1, MEMBER_2]));

      // A refresh whose round answers nothing must NOT empty the roster.
      holders.fixturesByRelay[RELAY] = [];
      getRosters().refresh();
      flushSync();
      await settle();
      expect(getRosters().membersByKey[key]).toEqual(new Set([MEMBER_1, MEMBER_2]));

      cleanup();
    });
  });
});
