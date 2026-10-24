// @ts-nocheck
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
/** @vitest-environment jsdom */
// src/lib/__tests__/content-removal.svelte.test.js
//
// useContentRemovals: loads the community's kind-1985 removal labels from
// public relays (never the group relay), keeps only the ones a current
// authority signed, and exposes the removed-target sets the views filter on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { flushSync } from 'svelte';

const COMMUNITY = 'a'.repeat(64);
const ADMIN = 'b'.repeat(64);
const STRANGER = 'd'.repeat(64);
const AUTHOR = 'e'.repeat(64);
const GROUPS_RELAY = 'wss://groups.example/';

/** @type {any} */
let rosterState;
vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: vi.fn(() => () => rosterState)
}));

const loaderCalls = vi.hoisted(() => /** @type {any[]} */ ([]));
const loaderSubs = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn((pool, relays, filter) => {
    loaderCalls.push({ relays, filter });
    return () => ({
      subscribe: () => {
        const sub = { unsubscribe: vi.fn() };
        loaderSubs.push(sub);
        return sub;
      }
    });
  })
}));
// applesauce v7 moved block paging out of the SDK: the app's timeline loader is
// the local port in $lib/loaders/timeline-loader.js and takes the mock above.
vi.mock('$lib/loaders/timeline-loader.js', async () => {
  const loaders = /** @type {any} */ (await import('applesauce-loaders/loaders'));
  return { createTimelineLoader: loaders.createTimelineLoader };
});
vi.mock('$lib/loaders/base.js', () => ({ timedPool: () => ({}) }));

const labels$ = vi.hoisted(() => ({ current: /** @type {any} */ (null) }));
const modelCalls = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn((Model, filter) => {
      modelCalls.push(filter);
      return labels$.current;
    })
  }
}));
vi.mock('applesauce-core/models', () => ({ TimelineModel: function TimelineModel() {} }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://communikey.example/'],
  getAllLookupRelays: () => ['wss://lookup.example/', 'wss://communikey.example/']
}));

const { useContentRemovals } = await import('$lib/groups/content-removal.svelte.js');

const moderatedCommunity = {
  kind: 10222,
  pubkey: COMMUNITY,
  created_at: 1000,
  content: '',
  tags: [
    ['membership', 'root1', GROUPS_RELAY],
    ['r', 'wss://community.example/'],
    ['content', 'Articles'],
    ['k', '30023']
  ]
};

/** @param {string} pubkey @param {string} id */
const label = (pubkey, id) => ({
  kind: 1985,
  pubkey,
  id,
  created_at: 2000,
  content: '',
  tags: [
    ['L', 'communikey.moderation'],
    ['l', 'remove', 'communikey.moderation'],
    ['h', COMMUNITY],
    ['e', '1'.repeat(64)],
    ['a', `30023:${AUTHOR}:my-article`]
  ]
});

describe('useContentRemovals', () => {
  /** @type {(() => void) | undefined} */
  let cleanup;

  beforeEach(() => {
    vi.clearAllMocks();
    loaderCalls.length = 0;
    loaderSubs.length = 0;
    modelCalls.length = 0;
    labels$.current = new BehaviorSubject([]);
    rosterState = {
      pointer: { id: 'root1', relay: GROUPS_RELAY },
      refresh: vi.fn(),
      members: new Set([ADMIN]),
      admins: [{ pubkey: ADMIN, roles: ['admin'] }],
      isLoading: false,
      isMember: () => true,
      rolesOf: () => []
    };
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('queries kind 1985 scoped by #h and #L on public relays, never the group relay', () => {
    let get;
    cleanup = $effect.root(() => {
      get = useContentRemovals(() => moderatedCommunity);
    });
    flushSync();
    expect(loaderCalls).toHaveLength(1);
    const { relays, filter } = loaderCalls[0];
    expect(filter).toEqual({
      kinds: [1985],
      '#h': [COMMUNITY],
      '#L': ['communikey.moderation']
    });
    expect(relays).toEqual([
      'wss://communikey.example/',
      'wss://community.example/',
      'wss://lookup.example/'
    ]);
    expect(relays).not.toContain(GROUPS_RELAY);
    expect(modelCalls[0]).toEqual(filter);
    expect(get().removed.ids.size).toBe(0);
  });

  it('honours an admin label and ignores a stranger label, reactively', () => {
    let get;
    cleanup = $effect.root(() => {
      get = useContentRemovals(() => moderatedCommunity);
    });
    flushSync();
    labels$.current.next([label(STRANGER, '6'.repeat(64)), label(ADMIN, '7'.repeat(64))]);
    flushSync();
    const view = get();
    expect(view.labels.map((l) => l.id)).toEqual(['7'.repeat(64)]);
    expect(view.removed.ids.has('1'.repeat(64))).toBe(true);
    expect(view.removed.addresses.has(`30023:${AUTHOR}:my-article`)).toBe(true);

    // Demotion revokes retroactively — nothing to delete.
    rosterState = { ...rosterState, admins: [{ pubkey: ADMIN, roles: ['publisher'] }] };
    expect(get().labels).toEqual([]);
  });

  it('loads nothing without a community and tears down what it opened', () => {
    let get;
    cleanup = $effect.root(() => {
      get = useContentRemovals(() => null);
    });
    flushSync();
    expect(loaderCalls).toHaveLength(0);
    expect(get().removed.ids.size).toBe(0);

    cleanup();
    cleanup = undefined;
    cleanup = $effect.root(() => {
      get = useContentRemovals(() => moderatedCommunity);
    });
    flushSync();
    expect(loaderSubs).toHaveLength(1);
    cleanup();
    cleanup = undefined;
    expect(loaderSubs[0].unsubscribe).toHaveBeenCalled();
  });
});
