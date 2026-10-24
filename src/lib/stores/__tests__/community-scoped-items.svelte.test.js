// @ts-nocheck
/* eslint-disable no-undef -- runes are available in .svelte.js context */
/**
 * useCommunityScopedItems: the discover page's community-filtered feed —
 * items of one or several communities from CommunityActivityModel, merged
 * and deduped by id, each community gated by its section access rules.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';
import { flushSync } from 'svelte';

const models = new Map();
const replaceables = new Map();
const loaderCleanup = vi.fn();
const accessCleanup = vi.fn();
let accessCallbacks = new Map();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: (_Model, pubkey) => {
      const s = new Subject();
      models.set(pubkey, s);
      return s;
    },
    replaceable: (_kind, pubkey) => {
      const s = new Subject();
      replaceables.set(pubkey, s);
      return s;
    }
  }
}));
vi.mock('$lib/models/community-content.js', () => ({ CommunityActivityModel: class {} }));
vi.mock('$lib/loaders/community-activity.js', () => ({
  useCommunityActivityLoader: vi.fn(() => ({ cleanup: loaderCleanup }))
}));
vi.mock('$lib/groups/community-access-subscription.js', () => ({
  subscribeToCommunityAccess: vi.fn((communityEvent, _relays, cb) => {
    accessCallbacks.set(communityEvent.pubkey, cb);
    return { cleanup: accessCleanup };
  })
}));
vi.mock('$lib/helpers/contentTypes.js', () => ({
  // Test gate: keep items whose author the access rules allow
  filterEventsByAccess: (items, _communityEvent, access) =>
    items.filter((i) => (access.getAllowedAuthors('x') ?? [i.pubkey]).includes(i.pubkey))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getCommunikeyRelays: () => [] }));

const { useCommunityScopedItems } = await import('../community-scoped-items.svelte.js');

const C1 = '1'.repeat(64);
const C2 = '2'.repeat(64);
const item = (id, pubkey = 'a'.repeat(64)) => ({ id, pubkey, kind: 30023, tags: [], content: '' });

function mount(getTargets) {
  let hook;
  const cleanup = $effect.root(() => {
    hook = useCommunityScopedItems(getTargets);
  });
  flushSync();
  return { hook, cleanup };
}

describe('useCommunityScopedItems', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // the model subscription is debounced by 100 ms
    models.clear();
    replaceables.clear();
    accessCallbacks = new Map();
    loaderCleanup.mockClear();
    accessCleanup.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('is empty without targets and starts nothing', () => {
    const { hook } = mount(() => []);
    expect(hook.items).toEqual([]);
    expect(models.size).toBe(0);
  });

  it('merges the communities and dedupes by id, direct before reposted', () => {
    const { hook } = mount(() => [C1, C2]);
    models.get(C1).next([item('shared'), item('one')]);
    models.get(C2).next([{ ...item('shared'), _sharedBy: C2 }, item('two')]);
    vi.advanceTimersByTime(100);
    flushSync();
    expect(hook.items.map((i) => i.id)).toEqual(['shared', 'one', 'two']);
    expect(hook.items[0]._sharedBy).toBeUndefined();
  });

  it("applies a community's access rules once they arrive and renders unfiltered before", () => {
    const { hook } = mount(() => [C1]);
    models.get(C1).next([item('member', 'm'.repeat(64)), item('stranger', 's'.repeat(64))]);
    vi.advanceTimersByTime(100);
    flushSync();
    expect(hook.items).toHaveLength(2);
    replaceables.get(C1).next({ pubkey: C1, kind: 10222, tags: [] });
    accessCallbacks.get(C1)({ isLoading: false, getAllowedAuthors: () => ['m'.repeat(64)] });
    flushSync();
    expect(hook.items.map((i) => i.id)).toEqual(['member']);
  });

  it('tears everything down when the targets go away', () => {
    let targets = $state([C1]);
    const { hook } = mount(() => targets);
    const model = models.get(C1);
    replaceables.get(C1).next({ pubkey: C1, kind: 10222, tags: [] });
    expect(model.observed).toBe(true);
    targets = [];
    flushSync();
    expect(hook.items).toEqual([]);
    expect(model.observed).toBe(false);
    expect(loaderCleanup).toHaveBeenCalled();
    expect(accessCleanup).toHaveBeenCalled();
  });
});
