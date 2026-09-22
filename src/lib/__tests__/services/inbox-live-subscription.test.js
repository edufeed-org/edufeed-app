// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const noopSub = { unsubscribe: vi.fn() };
const noopObservable = { subscribe: vi.fn(() => noopSub) };

const liveSubscription = vi.hoisted(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }));
const group = vi.hoisted(() => ({ subscription: vi.fn(() => liveSubscription) }));
const pool = vi.hoisted(() => ({ group: vi.fn(() => group) }));
const eventStore = vi.hoisted(() => ({ add: vi.fn(), model: vi.fn(), replaceable: vi.fn() }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore, pool }));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  addressLoader: vi.fn(() => noopObservable),
  eventLoader: vi.fn(() => noopObservable)
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay1'],
  getCalendarRelays: () => ['wss://relay2'],
  getEducationalRelays: () => [],
  getNotificationFallbackRelays: () => [],
  getAllLookupRelays: () => ['wss://lookup1'],
  getEventLoaderLookupRelays: () => [],
  getGroupsRelays: () => []
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn(() => () => noopObservable)
}));
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TimelineModel' }));
vi.mock('$lib/helpers/event-factory.js', () => ({
  finalizeDraft: vi.fn(async (draft) => await draft)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: null } }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getReadRelays: vi.fn(async () => ['wss://user-inbox.example']),
  getWriteRelays: vi.fn(async () => [])
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getUnreadDmCount: () => 0,
  markAllDmConversationsAsRead: vi.fn()
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({ parseAddressPointerFromATag: vi.fn() }));

const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => void (store[key] = String(value))),
    removeItem: vi.fn((key) => void delete store[key]),
    clear: () => void (store = {})
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const PUBKEY = 'a'.repeat(64);

describe('inbox standing subscription', () => {
  let mod;
  beforeEach(async () => {
    vi.clearAllMocks();
    eventStore.model.mockReturnValue(noopObservable);
    eventStore.replaceable.mockReturnValue(noopObservable);
    mod = await import('$lib/services/inbox-service.svelte.js');
  });
  afterEach(() => mod.cleanup());

  it('keeps a live subscription open on the notification relays from now on', async () => {
    const before = Math.floor(Date.now() / 1000);
    mod.initializeInbox(PUBKEY);
    // The one-shot loaders fetch a 7-day window; the live leg must not
    // re-fetch that history — its `since` is the moment we subscribed.
    expect(pool.group).toHaveBeenCalledWith(['wss://relay1', 'wss://relay2'], false);
    const filters = group.subscription.mock.calls[0][0];
    expect(filters).toEqual(mod.buildMainFilter(PUBKEY, filters[0].since));
    expect(filters[0].since).toBeGreaterThanOrEqual(before);
    expect(filters[0].since).toBeLessThanOrEqual(before + 5);
    expect(liveSubscription.subscribe).toHaveBeenCalled();
  });

  it('adds live events to the event store so the existing model picks them up', () => {
    mod.initializeInbox(PUBKEY);
    const observer = liveSubscription.subscribe.mock.calls[0][0];
    const event = { id: 'x', kind: 7, pubkey: 'b'.repeat(64), created_at: 1, tags: [] };
    observer.next(event);
    expect(eventStore.add).toHaveBeenCalledWith(event);
  });

  it('also opens the live leg on the user read relays once they resolve', async () => {
    mod.initializeInbox(PUBKEY);
    await new Promise((r) => setTimeout(r, 0));
    // getSupplementalNotificationRelays normalizes URLs (trailing slash).
    expect(pool.group).toHaveBeenCalledWith(['wss://user-inbox.example/'], false);
    expect(group.subscription.mock.calls[1][0]).toEqual(group.subscription.mock.calls[0][0]);
  });

  it('closes the live subscriptions on cleanup', async () => {
    mod.initializeInbox(PUBKEY);
    await new Promise((r) => setTimeout(r, 0));
    const subs = liveSubscription.subscribe.mock.results.map((r) => r.value);
    expect(subs.length).toBeGreaterThanOrEqual(2);
    mod.cleanup();
    for (const sub of subs) expect(sub.unsubscribe).toHaveBeenCalled();
  });
});
