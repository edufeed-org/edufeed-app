// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// useChannelRosters: one batched 39001+39002 request per RELAY over a set of
// channel pointers, with the same value-stable-key + 300ms debounce shape as
// host-unread.svelte.js (see its header comment for why identity churn on
// the pointer array must not reopen every relay subscription).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const RELAY = 'wss://groups.example/';
const OTHER_RELAY = 'wss://other.example/';

const ADMIN = 'a'.repeat(64);
const MEMBER_1 = 'b'.repeat(64);
const MEMBER_2 = 'c'.repeat(64);

const holders = vi.hoisted(() => ({
  requestCalls: /** @type {any[]} */ ([]),
  /** @type {Record<string, any[]>} */
  fixturesByRelay: {},
  // Relays in here error the request instead of completing normally — this
  // is what the real pool does for a truly silent/unresponsive relay: rxjs
  // `timeout({first: ms})` with no `with:` fallback errors, it does not
  // complete (see relay.js's request() in applesauce-relay — no `with:`
  // clause on that timeout operator). A relay that DOES answer with EOSE
  // and zero matching events completes instead (modelled by `of()` below
  // with an empty fixture list) — both must resolve-empty the same way.
  errorRelays: /** @type {Set<string>} */ (new Set())
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { of, throwError } = await import('rxjs');
  return {
    pool: {
      relay: (/** @type {string} */ url) => ({
        request: (/** @type {any} */ filter, /** @type {any} */ opts) => {
          holders.requestCalls.push({ url, filter, opts });
          if (holders.errorRelays.has(url)) return throwError(() => new Error('relay timeout'));
          const events = holders.fixturesByRelay[url] ?? [];
          return of(...events);
        }
      })
    }
  };
});

import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
import { channelKey } from '$lib/groups/community-pointer.js';
import { rosterView } from '$lib/groups/root-roster.js';

/** @param {string} id */
const membersEvent = (id) => ({
  kind: 39002,
  tags: [
    ['d', id],
    ['p', MEMBER_1],
    ['p', MEMBER_2]
  ]
});

/** @param {string} id */
const adminsEvent = (id) => ({
  kind: 39001,
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
    // No 39001 fixture for 'random' — it simply never appears.
    expect(adminsByKey[keyRandom]).toBeUndefined();

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

    // Fresh array, identical content.
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

  it('refresh() does not clear a channel whose fresh event has not landed yet', async () => {
    const pointerA = { id: 'general', relay: RELAY };
    const pointerB = { id: 'random', relay: RELAY };
    holders.fixturesByRelay[RELAY] = [membersEvent('general'), membersEvent('random')];

    let pointers = $state.raw([pointerA, pointerB]);
    const { getRosters, cleanup } = mountHook(() => pointers);
    flushSync();
    await settle();

    const keyGeneral = channelKey(pointerA);
    const keyRandom = channelKey(pointerB);
    expect(getRosters().membersByKey[keyGeneral]).toEqual(new Set([MEMBER_1, MEMBER_2]));
    expect(getRosters().membersByKey[keyRandom]).toEqual(new Set([MEMBER_1, MEMBER_2]));

    // This refresh round only 'general' answers — 'random' must stay put
    // (stale-while-revalidate), not vanish because the new round hasn't
    // heard from it yet.
    holders.fixturesByRelay[RELAY] = [membersEvent('general')];
    getRosters().refresh();
    flushSync();
    await settle();

    expect(getRosters().membersByKey[keyGeneral]).toEqual(new Set([MEMBER_1, MEMBER_2]));
    expect(getRosters().membersByKey[keyRandom]).toEqual(new Set([MEMBER_1, MEMBER_2]));

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

  // Dead-relay spinner fix: a relay request that finishes (EOSE with no
  // matching roster, or the pool's own timeout) without ever delivering
  // 39001/39002 for a requested id must resolve that id to non-member
  // instead of leaving rosterView().isLoading stuck true forever.
  describe('resolves requested ids to empty instead of leaving them loading', () => {
    it('a relay that completes with zero matching events fills an empty Set for the requested key', async () => {
      const pointerA = { id: 'general', relay: RELAY };
      // No fixture registered for RELAY — of() emits nothing and completes.
      let pointers = $state.raw([pointerA]);
      const { getRosters, cleanup } = mountHook(() => pointers);
      flushSync();
      await settle();

      const key = channelKey(pointerA);
      const { membersByKey, adminsByKey } = getRosters();
      expect(membersByKey[key]).toEqual(new Set());

      // The integration point that actually matters: rosterView must stop
      // reporting isLoading once the relay has spoken, even with no roster.
      const view = rosterView(pointerA, membersByKey, adminsByKey);
      expect(view.isLoading).toBe(false);
      expect(view.isMember(MEMBER_1)).toBe(false);

      cleanup();
    });

    it('events-then-complete preserves the delivered roster instead of overwriting it with empty', async () => {
      const pointerA = { id: 'general', relay: RELAY };
      holders.fixturesByRelay[RELAY] = [membersEvent('general')];

      let pointers = $state.raw([pointerA]);
      const { getRosters, cleanup } = mountHook(() => pointers);
      flushSync();
      await settle();

      const key = channelKey(pointerA);
      expect(getRosters().membersByKey[key]).toEqual(new Set([MEMBER_1, MEMBER_2]));

      cleanup();
    });

    it('refresh() over a relay that keeps completing empty still terminates isLoading', async () => {
      const pointerA = { id: 'general', relay: RELAY };
      // No fixture ever registered — every round completes with no events.
      let pointers = $state.raw([pointerA]);
      const { getRosters, cleanup } = mountHook(() => pointers);
      flushSync();
      await settle();

      const key = channelKey(pointerA);
      expect(getRosters().membersByKey[key]).toEqual(new Set());

      getRosters().refresh();
      flushSync();
      await settle();

      expect(getRosters().membersByKey[key]).toEqual(new Set());
      const view = rosterView(pointerA, getRosters().membersByKey, getRosters().adminsByKey);
      expect(view.isLoading).toBe(false);

      cleanup();
    });

    it('a relay that errors instead of completing (dead/unresponsive relay) also resolves the requested id to empty', async () => {
      const pointerA = { id: 'general', relay: RELAY };
      holders.errorRelays = new Set([RELAY]);

      let pointers = $state.raw([pointerA]);
      const { getRosters, cleanup } = mountHook(() => pointers);
      flushSync();
      await settle();

      const key = channelKey(pointerA);
      expect(getRosters().membersByKey[key]).toEqual(new Set());

      cleanup();
    });

    it('a completing relay only fills the ids it was actually asked for, not siblings on other relays', async () => {
      const pointerA = { id: 'general', relay: RELAY };
      const pointerB = { id: 'other-channel', relay: OTHER_RELAY };
      holders.fixturesByRelay[OTHER_RELAY] = [membersEvent('other-channel')];
      // RELAY has no fixture — completes empty for 'general'.

      let pointers = $state.raw([pointerA, pointerB]);
      const { getRosters, cleanup } = mountHook(() => pointers);
      flushSync();
      await settle();

      const { membersByKey } = getRosters();
      expect(membersByKey[channelKey(pointerA)]).toEqual(new Set());
      expect(membersByKey[channelKey(pointerB)]).toEqual(new Set([MEMBER_1, MEMBER_2]));

      cleanup();
    });
  });
});
