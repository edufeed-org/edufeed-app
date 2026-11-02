// @ts-nocheck
/* eslint-disable no-undef -- $effect / $state are Svelte runes, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * useFollowedBy(getPubkeys) — reactive Map<pubkey, follows-who-follow-them>
 * for the people on screen; requests contact lists for new subjects and
 * re-publishes when they arrive. Only people with at least one such follow
 * are in the map.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const S1 = 'a'.repeat(64);
const S2 = 'b'.repeat(64);
const F1 = '1'.repeat(64);

const loader = vi.hoisted(() => ({
  followers: new Map(),
  requestFollowedBy: vi.fn(),
  updates: null
}));
vi.mock('$lib/loaders/followed-by.js', async () => {
  const { Subject } = await import('rxjs');
  loader.updates = new Subject();
  return {
    requestFollowedBy: loader.requestFollowedBy,
    followersAmong: (pk) => loader.followers.get(pk) ?? [],
    followedByUpdates: loader.updates
  };
});
const contacts = vi.hoisted(() => ({ list: [] }));
vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: {
    get contacts() {
      return contacts.list;
    }
  }
}));

const { useFollowedBy } = await import('$lib/stores/followed-by.svelte.js');

describe('useFollowedBy', () => {
  let cleanup;
  beforeEach(() => {
    loader.followers = new Map();
    loader.requestFollowedBy.mockReset();
    contacts.list = [F1];
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function mount(pubkeys) {
    let get;
    cleanup = $effect.root(() => {
      get = useFollowedBy(() => pubkeys);
    });
    flushSync();
    return () => get();
  }

  it('requests the subjects with the viewer’s follows', () => {
    mount([S1, S2]);
    expect(loader.requestFollowedBy).toHaveBeenCalledWith([S1, S2], [F1]);
  });

  it('maps only people with followers, and updates when contact lists arrive', () => {
    const get = mount([S1, S2]);
    expect(get().size).toBe(0);
    loader.followers.set(S2, [F1]);
    loader.updates.next(undefined);
    flushSync();
    expect([...get()]).toEqual([[S2, [F1]]]);
  });

  it('keeps the same Map when nothing changed', () => {
    loader.followers.set(S1, [F1]);
    const get = mount([S1]);
    const first = get();
    loader.updates.next(undefined);
    flushSync();
    expect(get()).toBe(first);
  });
});
