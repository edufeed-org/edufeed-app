// @ts-nocheck
/* eslint-disable no-undef -- $effect / $state are Svelte runes, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * useFollowGraph(getPubkey) — followers (contact lists that p-tag the
 * person) and following (their own contact list) for a profile, fetched
 * from the lookup relays with a capped follower REQ and read back from the
 * EventStore, store first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const P = 'f'.repeat(64);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const store = vi.hoisted(() => ({ timeline: null, replaceable: null, filters: [] }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { Subject } = await import('rxjs');
  return {
    eventStore: {
      model: (_model, filter) => {
        store.filters.push(filter);
        store.timeline = new Subject();
        return store.timeline;
      },
      replaceable: () => {
        store.replaceable = new Subject();
        return store.replaceable;
      }
    }
  };
});
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TimelineModel' }));
const loaders = vi.hoisted(() => ({ fetchEvents: vi.fn() }));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents: loaders.fetchEvents }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: () => ['wss://lookup.example']
}));

const { useFollowGraph, FOLLOWER_CAP } = await import('$lib/stores/follow-graph.svelte.js');

const kind3 = (pubkey, follows) => ({
  kind: 3,
  pubkey,
  created_at: 1,
  tags: follows.map((p) => ['p', p])
});

describe('useFollowGraph', () => {
  let cleanup;
  beforeEach(() => {
    store.filters = [];
    loaders.fetchEvents.mockReset();
    loaders.fetchEvents.mockReturnValue({ subscribe: () => ({ unsubscribe: () => {} }) });
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function mount(pubkey) {
    let get;
    cleanup = $effect.root(() => {
      get = useFollowGraph(() => pubkey);
    });
    flushSync();
    return () => get();
  }

  it('asks the lookup relays for the followers (capped) and the person’s own list', () => {
    mount(P);
    expect(loaders.fetchEvents).toHaveBeenCalledWith(
      ['wss://lookup.example'],
      [
        { kinds: [3], '#p': [P], limit: FOLLOWER_CAP },
        { kinds: [3], authors: [P], limit: 1 }
      ],
      { cache: true }
    );
    expect(store.filters).toEqual([{ kinds: [3], '#p': [P] }]);
  });

  it('reads followers and following from the store as they arrive', () => {
    const get = mount(P);
    expect(get()).toMatchObject({ followers: [], following: [], capped: false });
    store.timeline.next([kind3(A, [P]), kind3(B, [P, A])]);
    store.replaceable.next(kind3(P, [A]));
    flushSync();
    expect(get()).toMatchObject({ followers: [A, B], following: [A], capped: false });
  });

  it('marks the follower count capped once the capped fetch is full', () => {
    const get = mount(P);
    const many = Array.from({ length: FOLLOWER_CAP }, (_, i) =>
      kind3(i.toString(16).padStart(64, '0'), [P])
    );
    store.timeline.next(many);
    flushSync();
    expect(get().capped).toBe(true);
  });
});
