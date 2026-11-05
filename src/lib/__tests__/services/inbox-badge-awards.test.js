// @ts-nocheck
/** @vitest-environment node */
/**
 * Badge awards (NIP-58 kind 8) reach the inbox: the main filter asks for
 * them history and live, and the user's own profile-badges list (kind 10008,
 * deprecated kind 30008 `profile_badges`) is loaded once so each row knows
 * whether its award was already accepted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const noopSub = { unsubscribe: vi.fn() };
const noopObservable = { subscribe: vi.fn(() => noopSub) };

const liveSubscription = vi.hoisted(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }));
const group = vi.hoisted(() => ({ subscription: vi.fn(() => liveSubscription) }));
const relayObject = vi.hoisted(() => ({ url: 'wss://groups.example/' }));
const pool = vi.hoisted(() => ({ group: vi.fn(() => group), relay: vi.fn(() => relayObject) }));
const eventStore = vi.hoisted(() => ({ add: vi.fn(), model: vi.fn(), replaceable: vi.fn() }));
const fetchEvents = vi.hoisted(() =>
  vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }))
);
const addressLoader = vi.hoisted(() => vi.fn());
const manager = vi.hoisted(() => ({ active: /** @type {any} */ (null) }));
const loadProfileBadgeLists = vi.hoisted(() =>
  vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) }))
);
vi.mock('$lib/loaders/profile-badges.js', () => ({ loadProfileBadgeLists }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore, pool }));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  fetchEvents,
  addressLoader,
  eventLoader: vi.fn(() => noopObservable)
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay1'],
  getCalendarRelays: () => [],
  getEducationalRelays: () => [],
  getNotificationFallbackRelays: () => [],
  getAllLookupRelays: () => ['wss://lookup1'],
  getEventLoaderLookupRelays: () => [],
  getGroupsRelays: () => []
}));
vi.mock('$lib/groups/relay-auth.js', () => ({ authenticateOnce: vi.fn() }));
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TimelineModel' }));
vi.mock('$lib/helpers/event-factory.js', () => ({
  finalizeDraft: vi.fn(async (draft) => await draft)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getReadRelays: vi.fn(async () => []),
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
const ISSUER = 'b'.repeat(64);

/** A store observable that hands every subscriber the given event once. */
const emitting = (event) => ({
  subscribe: vi.fn((next) => {
    const fn = typeof next === 'function' ? next : next?.next;
    fn?.(event);
    return { unsubscribe: vi.fn() };
  })
});

describe('inbox: badge awards', () => {
  let mod;
  beforeEach(async () => {
    vi.clearAllMocks();
    eventStore.model.mockReturnValue(noopObservable);
    eventStore.replaceable.mockReturnValue(noopObservable);
    addressLoader.mockReturnValue(noopObservable);
    mod = await import('$lib/services/inbox-service.svelte.js');
  });
  afterEach(() => mod.cleanup());

  it('asks for kind 8 awards that p-tag the user, history, live and in the model', () => {
    mod.initializeInbox(PUBKEY);

    const historyKinds = fetchEvents.mock.calls[0][1].flatMap((f) => f.kinds);
    expect(historyKinds).toContain(8);

    const liveKinds = group.subscription.mock.calls[0][0].flatMap((f) => f.kinds);
    expect(liveKinds).toContain(8);

    const modelCall = eventStore.model.mock.calls.find((c) => Array.isArray(c[1]));
    expect(modelCall[1].flatMap((f) => f.kinds)).toContain(8);
  });

  it("loads the user's profile-badges lists through the shared loader (lookup + own outbox)", () => {
    mod.initializeInbox(PUBKEY);
    expect(loadProfileBadgeLists).toHaveBeenCalledWith(PUBKEY);
  });

  it('exposes the accepted award ids from both lists', () => {
    const modern = {
      kind: 10008,
      pubkey: PUBKEY,
      created_at: 20,
      content: '',
      tags: [
        ['a', `30009:${ISSUER}:bravery`],
        ['e', '1'.repeat(64)]
      ]
    };
    const legacy = {
      kind: 30008,
      pubkey: PUBKEY,
      created_at: 10,
      content: '',
      tags: [
        ['d', 'profile_badges'],
        ['a', `30009:${ISSUER}:honor`],
        ['e', '2'.repeat(64)]
      ]
    };
    eventStore.replaceable.mockImplementation((kind) =>
      kind === 10008 ? emitting(modern) : kind === 30008 ? emitting(legacy) : noopObservable
    );

    expect(mod.getAcceptedAwardIds().size).toBe(0);
    mod.initializeInbox(PUBKEY);

    const ids = mod.getAcceptedAwardIds();
    expect(ids.has('1'.repeat(64))).toBe(true);
    expect(ids.has('2'.repeat(64))).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('forgets the accepted ids on cleanup', () => {
    const modern = {
      kind: 10008,
      pubkey: PUBKEY,
      created_at: 20,
      content: '',
      tags: [
        ['a', `30009:${ISSUER}:bravery`],
        ['e', '1'.repeat(64)]
      ]
    };
    eventStore.replaceable.mockImplementation((kind) =>
      kind === 10008 ? emitting(modern) : noopObservable
    );
    mod.initializeInbox(PUBKEY);
    expect(mod.getAcceptedAwardIds().size).toBe(1);
    mod.cleanup();
    expect(mod.getAcceptedAwardIds().size).toBe(0);
  });
});
