// @ts-nocheck
/* eslint-disable no-undef -- $effect/$state are Svelte runes, available in .svelte.test.js context */
/** @vitest-environment jsdom */
// useCommunityChannels: discover a moderated community's channels from the
// relay SUBTREE (the /c/<rootId> endpoint's {kinds:[39000]}), fed THROUGH the
// eventStore and read back from it — NOT from a kind-10222 `group` pointer.
// Mirrors the channel-rosters engine: value-stable key, 300ms debounce, a
// `fetched` flag that never fabricates an empty list, and a store-backed read
// so a remount is populated with no reliance on relay replay.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const ROOT = 'root123';
const RELAY = 'wss://groups.example/';
const RELAY_PK = '9'.repeat(64);

const holders = vi.hoisted(() => ({
  requestCalls: /** @type {any[]} */ ([]),
  /** @type {Record<string, any[]>} */
  fixturesByRelay: {},
  /** Per-url live feed: tests push post-EOSE events here to model another
   *  admin creating a channel while the subscription is open. */
  liveByRelay: /** @type {Record<string, any>} */ ({}),
  errorRelays: /** @type {Set<string>} */ (new Set()),
  /** @type {any} */ eventStore: null
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  const { of, merge, Subject, throwError } = await import('rxjs');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  holders.eventStore = eventStore;
  return {
    eventStore,
    pool: {
      relay: (/** @type {string} */ url) => ({
        // Relay.subscription semantics: stored events, then "EOSE", then the
        // stream STAYS OPEN and live events keep arriving.
        subscription: (/** @type {any} */ filter, /** @type {any} */ opts) => {
          holders.requestCalls.push({ url, filter, opts });
          if (holders.errorRelays.has(url)) return throwError(() => new Error('relay timeout'));
          const live = (holders.liveByRelay[url] ??= new Subject());
          return merge(of(...(holders.fixturesByRelay[url] ?? []), 'EOSE'), live);
        }
      })
    }
  };
});

// No signed-in user → proactive auth is a no-op; authenticateOnce is never
// called, but mock it so the real module (which reaches for a signer) stays out.
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => null }));
vi.mock('$lib/groups/relay-auth.js', () => ({
  authenticateOnce: () => Promise.resolve({ ok: false })
}));

import { useCommunityChannels } from '$lib/groups/community-channels.svelte.js';
import { communityGroupsEndpoint, flatGroupsRelay } from '$lib/groups/community-endpoint.js';

const ENDPOINT = communityGroupsEndpoint(flatGroupsRelay(RELAY), ROOT);

let evtSeq = 0;
/** @param {string} id @param {string[][]} [extra] @param {number} [created_at] */
const meta = (id, extra = [], created_at = 1000) => ({
  kind: 39000,
  pubkey: RELAY_PK,
  created_at,
  id: `ev-${id}-${created_at}-${evtSeq++}`,
  sig: 'x',
  content: '',
  tags: [['d', id], ...extra]
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

/** @param {() => any} getRoot */
function mountHook(getRoot) {
  /** @type {() => any} */
  let get;
  const cleanup = $effect.root(() => {
    get = useCommunityChannels(getRoot);
  });
  flushSync();
  return { get, cleanup };
}

describe('useCommunityChannels', () => {
  beforeEach(() => {
    holders.requestCalls = [];
    holders.fixturesByRelay = {};
    holders.liveByRelay = {};
    holders.errorRelays = new Set();
    holders.eventStore?.removeByFilters?.({ kinds: [39000] });
    holders.eventStore?.database?.clear?.();
  });

  it('discovers root + parent==root children from the /c endpoint, with the relay-observable level', async () => {
    holders.fixturesByRelay[ENDPOINT] = [
      meta(ROOT, [['name', 'Community']]),
      meta('allgemein', [
        ['parent', ROOT],
        ['name', 'Allgemein']
      ]),
      meta('leitung', [['parent', ROOT], ['name', 'Leitung'], ['private']])
    ];

    const pointer = $state.raw({ id: ROOT, relay: RELAY });
    const { get, cleanup } = mountHook(() => pointer);
    flushSync();
    await settle();

    // ONE request, to the per-community endpoint, for all 39000s.
    expect(holders.requestCalls).toHaveLength(1);
    expect(holders.requestCalls[0].url).toBe(ENDPOINT);
    expect(holders.requestCalls[0].filter).toEqual({ kinds: [39000] });

    const { channels, rootChannel, fetched } = get();
    expect(fetched).toBe(true);
    expect(rootChannel?.id).toBe(ROOT);
    expect(rootChannel?.name).toBe('Community');
    expect(channels.map((c) => c.id)).toEqual(['allgemein', 'leitung']);
    expect(channels.find((c) => c.id === 'allgemein')?.level).toBe('world');
    expect(channels.find((c) => c.id === 'leitung')?.level).toBe('invited');
    expect(channels.every((c) => c.relay === ENDPOINT)).toBe(true);

    cleanup();
  });

  it('ignores a 39000 whose parent is a different community', async () => {
    holders.fixturesByRelay[ENDPOINT] = [
      meta(ROOT),
      meta('foreign', [
        ['parent', 'otherRoot'],
        ['name', 'Foreign']
      ])
    ];
    const pointer = $state.raw({ id: ROOT, relay: RELAY });
    const { get, cleanup } = mountHook(() => pointer);
    flushSync();
    await settle();

    expect(get().channels).toEqual([]);
    cleanup();
  });

  // THE REGRESSION GUARD (mirrors channel-rosters): a second reader must see
  // the metadata the store already holds instantly, with the relay replaying
  // NOTHING.
  it('a second reader sees the stored subtree instantly, with no new relay event', async () => {
    holders.fixturesByRelay[ENDPOINT] = [
      meta(ROOT, [['name', 'Community']]),
      meta('allgemein', [
        ['parent', ROOT],
        ['name', 'Allgemein']
      ])
    ];
    const p1 = $state.raw({ id: ROOT, relay: RELAY });
    const first = mountHook(() => p1);
    flushSync();
    await settle();
    expect(first.get().channels.map((c) => c.id)).toEqual(['allgemein']);

    // Second reader; relay now answers NOTHING (like applesauce not replaying).
    holders.fixturesByRelay[ENDPOINT] = [];
    holders.requestCalls = [];
    const p2 = $state.raw({ id: ROOT, relay: RELAY });
    const second = mountHook(() => p2);
    flushSync();
    await settle();

    expect(second.get().channels.map((c) => c.id)).toEqual(['allgemein']);
    second.cleanup();
    first.cleanup();
  });

  it('resolves fetched=true when the endpoint errors, without fabricating channels', async () => {
    holders.errorRelays.add(ENDPOINT);
    const pointer = $state.raw({ id: ROOT, relay: RELAY });
    const { get, cleanup } = mountHook(() => pointer);
    flushSync();
    await settle();

    expect(get().fetched).toBe(true);
    expect(get().channels).toEqual([]);
    cleanup();
  });

  // Live discovery (laoc, 2026-08-27): the subscription stays open past
  // EOSE, so a channel another admin creates streams in without a refresh —
  // the one-shot request() this replaced only ever saw the initial snapshot.
  it('a 39000 arriving after EOSE appears live, with no new relay request', async () => {
    holders.fixturesByRelay[ENDPOINT] = [meta(ROOT, [['name', 'Community']])];
    const pointer = $state.raw({ id: ROOT, relay: RELAY });
    const { get, cleanup } = mountHook(() => pointer);
    flushSync();
    await settle();
    expect(get().fetched).toBe(true);
    expect(get().channels).toEqual([]);
    const callsAfterSettle = holders.requestCalls.length;

    holders.liveByRelay[ENDPOINT].next(
      meta('neu', [
        ['parent', ROOT],
        ['name', 'Neu']
      ])
    );
    flushSync();

    expect(get().channels.map((c) => c.id)).toEqual(['neu']);
    expect(holders.requestCalls.length).toBe(callsAfterSettle);
    cleanup();
  });

  it('is empty and unfetched-neutral when there is no root pointer', async () => {
    const pointer = $state.raw(null);
    const { get, cleanup } = mountHook(() => pointer);
    flushSync();
    await settle();

    expect(holders.requestCalls).toHaveLength(0);
    expect(get().channels).toEqual([]);
    expect(get().rootChannel).toBeNull();
    cleanup();
  });
});
