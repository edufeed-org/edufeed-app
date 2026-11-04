// @ts-nocheck
/* global $effect, $state */
/**
 * useJoinedCommunityItems — the per-community loader/model/ACL wiring that
 * the dashboard community feed and the phone Communities list share. One
 * activity + one bookmark loader per joined community, merged newest-first.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const spies = vi.hoisted(() => ({
  activityLoader: vi.fn(),
  activityCleanup: vi.fn(),
  bookmarkCleanup: vi.fn(),
  /** @type {Map<string, {next: (v: any[]) => void}>} */
  subjects: new Map(),
  /** when true, model subscriptions emit nothing on subscribe (async relay) */
  silentModels: false,
  /** @type {Map<string, (e: any) => void>} */
  replaceables: new Map()
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getCommunikeyRelays: () => [] }));
vi.mock('$lib/loaders/community-activity.js', () => ({
  useCommunityActivityLoader: (pk) => {
    spies.activityLoader(pk);
    return { cleanup: spies.activityCleanup };
  }
}));
vi.mock('$lib/loaders/social-bookmarks.js', () => ({
  useSocialBookmarksCommunityLoader: () => ({ cleanup: spies.bookmarkCleanup })
}));
vi.mock('$lib/groups/community-access-subscription.js', () => ({
  subscribeToCommunityAccess: () => ({ cleanup: () => {}, hasRestrictedSections: false })
}));
vi.mock('$lib/models/community-content.js', () => ({
  CommunityActivityModel: 'activity',
  CommunitySocialBookmarkModel: 'bookmarks'
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (model, pubkey) => ({
      subscribe: (obs) => {
        spies.subjects.set(`${model}:${pubkey}`, obs);
        if (!spies.silentModels) obs.next([]);
        return { unsubscribe: () => spies.subjects.delete(`${model}:${pubkey}`) };
      }
    }),
    replaceable: (_kind, pubkey) => ({
      subscribe: (cb) => {
        spies.replaceables.set(pubkey, cb);
        cb(undefined);
        return { unsubscribe: () => spies.replaceables.delete(pubkey) };
      }
    })
  }
}));

const { useJoinedCommunityItems } = await import('../joined-community-items.svelte.js');

const ev = (community, ts, kind = 30023) => ({
  id: `id-${community.slice(0, 1)}-${ts}`,
  kind,
  created_at: ts,
  pubkey: 'f'.repeat(64),
  tags: [['h', community]],
  content: ''
});

const emit = (model, pubkey, events) => spies.subjects.get(`${model}:${pubkey}`)?.next(events);

describe('useJoinedCommunityItems', () => {
  beforeEach(() => {
    spies.activityLoader.mockClear();
    spies.activityCleanup.mockClear();
    spies.bookmarkCleanup.mockClear();
    spies.subjects.clear();
    spies.replaceables.clear();
    spies.silentModels = false;
  });

  it("exposes each community's kind 10222 event so consumers need no second subscription", () => {
    let pubkeys = $state.raw([A]);
    let snapshot;
    const stop = $effect.root(() => {
      const get = useJoinedCommunityItems(() => pubkeys);
      $effect(() => {
        snapshot = get();
      });
    });
    flushSync();
    expect(snapshot.communityEvents.get(A)).toBeNull();
    const event = { kind: 10222, pubkey: A, tags: [], content: '' };
    spies.replaceables.get(A)?.(event);
    flushSync();
    expect(snapshot.communityEvents.get(A)).toBe(event);
    stop();
  });

  it('does not flip back to loading when the list changes and the models have not answered yet', () => {
    let pubkeys = $state.raw([A]);
    let snapshot;
    const stop = $effect.root(() => {
      const get = useJoinedCommunityItems(() => pubkeys);
      $effect(() => {
        snapshot = get();
      });
    });
    flushSync();
    emit('activity', A, [ev(A, 10)]);
    flushSync();
    expect(snapshot.isLoading).toBe(false);
    spies.silentModels = true;
    pubkeys = [A, B];
    flushSync();
    // store first: what is already there keeps rendering while B loads
    expect(snapshot.isLoading).toBe(false);
    stop();
  });

  it('starts one activity + one bookmark loader per community and merges their models', () => {
    let pubkeys = $state.raw([A, B]);
    let snapshot;
    const stop = $effect.root(() => {
      const get = useJoinedCommunityItems(() => pubkeys);
      $effect(() => {
        snapshot = get();
      });
    });
    flushSync();
    expect(spies.activityLoader).toHaveBeenCalledTimes(2);
    expect(snapshot.isLoading).toBe(false);
    emit('activity', A, [ev(A, 10), ev(A, 30)]);
    emit('bookmarks', B, [ev(B, 20, 39701)]);
    flushSync();
    expect(snapshot.items.map((e) => e.created_at)).toEqual([30, 20, 10]);
    expect(snapshot.perCommunity.get(A)).toHaveLength(2);
    expect(snapshot.perCommunity.get(B)).toHaveLength(1);
    stop();
  });

  it('cleans up when a community is removed and reports an empty list as not loading', () => {
    let pubkeys = $state.raw([A, B]);
    let snapshot;
    const stop = $effect.root(() => {
      const get = useJoinedCommunityItems(() => pubkeys);
      $effect(() => {
        snapshot = get();
      });
    });
    flushSync();
    pubkeys = [];
    flushSync();
    expect(spies.activityCleanup).toHaveBeenCalledTimes(2);
    expect(spies.bookmarkCleanup).toHaveBeenCalledTimes(2);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.isLoading).toBe(false);
    stop();
  });
});
