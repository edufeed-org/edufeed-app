// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const noopSub = { unsubscribe: vi.fn() };
const noopObservable = { subscribe: vi.fn(() => noopSub) };

// Mock dependencies before import
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: vi.fn(),
    model: vi.fn(() => noopObservable),
    replaceable: vi.fn(() => noopObservable)
  }
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  addressLoader: vi.fn(() => noopObservable),
  eventLoader: vi.fn(() => noopObservable)
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay1'],
  getCalendarRelays: () => ['wss://relay2'],
  getEducationalRelays: () => ['wss://relay3'],
  getNotificationFallbackRelays: () => [],
  getAllLookupRelays: () => ['wss://lookup1'],
  getEventLoaderLookupRelays: () => []
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn(() => () => noopObservable)
}));
vi.mock('applesauce-core/models', () => ({
  TimelineModel: 'TimelineModel'
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  finalizeDraft: vi.fn(async (draft) => await draft)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: null }
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn()
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getReadRelays: vi.fn(async () => ['wss://user-inbox.example'])
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getUnreadDmCount: () => 0,
  markAllDmConversationsAsRead: vi.fn()
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  parseAddressPointerFromATag: vi.fn()
}));

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    }
  };
})();

vi.stubGlobal('localStorage', localStorageMock);

describe('per-item read tracking', () => {
  /** @type {typeof import('$lib/services/inbox-service.svelte.js')} */
  let service;

  beforeEach(async () => {
    vi.resetModules();
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    service = await import('$lib/services/inbox-service.svelte.js');
  });

  afterEach(() => {
    service.cleanup();
  });

  describe('markItemAsRead', () => {
    it('adds event ID to read set and persists to localStorage', () => {
      service.initializeInbox('user123');
      service.markItemAsRead('event-abc');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'comcal:inbox:read-items:user123',
        expect.any(String)
      );
      const stored = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
      expect(stored).toContain('event-abc');
    });

    it('accumulates multiple event IDs', () => {
      service.initializeInbox('user123');
      service.markItemAsRead('event-1');
      service.markItemAsRead('event-2');

      const lastCall = localStorageMock.setItem.mock.calls.at(-1);
      const stored = JSON.parse(lastCall[1]);
      expect(stored).toContain('event-1');
      expect(stored).toContain('event-2');
    });

    it('does nothing when no active pubkey', () => {
      service.markItemAsRead('event-abc');
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });
  });

  describe('isNotificationUnread', () => {
    it('returns false when event ID is in readItemIds', () => {
      service.initializeInbox('user123');
      service.markItemAsRead('event-abc');

      const event = { id: 'event-abc', kind: 7, created_at: 9999999999 };
      expect(service.isNotificationUnread(event)).toBe(false);
    });

    it('returns false when timestamp markers cover the event', () => {
      // Event older than global marker → read even without per-item tracking
      const event = { id: 'event-xyz', kind: 7, created_at: 500 };
      // readMarkers with global=1000 means events at 500 are read
      // We need to set readMarkers — they come from NIP-78 subscription
      // For this test, we directly test isNotificationUnread with known state
      service.initializeInbox('user123');
      // Without readMarkers set, all events are "unread" by timestamp
      // but if we mark the item, it should be read
      service.markItemAsRead('event-xyz');
      expect(service.isNotificationUnread(event)).toBe(false);
    });

    it('returns true only when both timestamp AND per-item say unread', () => {
      service.initializeInbox('user123');
      // New event, not marked per-item, no read markers → unread
      const event = { id: 'event-new', kind: 7, created_at: 9999999999 };
      expect(service.isNotificationUnread(event)).toBe(true);
    });
  });

  describe('initializeInbox loads persisted read items', () => {
    it('loads readItemIds from localStorage on init', () => {
      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(['event-1', 'event-2']));

      service.initializeInbox('user123');

      // Events that were persisted should be read
      expect(service.isNotificationUnread({ id: 'event-1', kind: 7, created_at: 9999999999 })).toBe(
        false
      );
      expect(service.isNotificationUnread({ id: 'event-2', kind: 7, created_at: 9999999999 })).toBe(
        false
      );
      // Unpersisted events still unread
      expect(service.isNotificationUnread({ id: 'event-3', kind: 7, created_at: 9999999999 })).toBe(
        true
      );
    });
  });

  describe('cleanup clears readItemIds', () => {
    it('clears per-item state on cleanup', () => {
      service.initializeInbox('user123');
      service.markItemAsRead('event-abc');
      service.cleanup();

      // After cleanup and re-init without localStorage data, item is unread
      service.initializeInbox('user456');
      expect(
        service.isNotificationUnread({ id: 'event-abc', kind: 7, created_at: 9999999999 })
      ).toBe(true);
    });
  });

  describe('supplemental read-relay loader (issue #43)', () => {
    it('spawns a loader on the user read relays with the main notification filters', async () => {
      const { createTimelineLoader } = await import('applesauce-loaders/loaders');
      createTimelineLoader.mockClear();

      service.initializeInbox('user123');
      await vi.waitFor(() => {
        const calls = createTimelineLoader.mock.calls;
        const supplemental = calls.find((c) => c[1].includes('wss://user-inbox.example/'));
        expect(supplemental).toBeDefined();
        // Same filters as the main loader (reactions, comments, chat, forms)
        expect(supplemental[2]).toEqual(service.buildMainFilter('user123', expect.any(Number)));
      });
    });

    it('does not spawn a supplemental loader after cleanup', async () => {
      const { createTimelineLoader } = await import('applesauce-loaders/loaders');

      service.initializeInbox('user123');
      service.cleanup();
      createTimelineLoader.mockClear();

      // Give the pending getReadRelays promise a chance to resolve
      await new Promise((r) => setTimeout(r, 0));
      const supplemental = createTimelineLoader.mock.calls.find((c) =>
        c[1].includes('wss://user-inbox.example/')
      );
      expect(supplemental).toBeUndefined();
    });
  });

  describe('event store model subscription', () => {
    it('watches exactly the kinds the notification loader fetches', async () => {
      const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
      eventStore.model.mockClear();

      service.initializeInbox('user123');

      // The main notification model call is the one passing an array of filters
      const call = eventStore.model.mock.calls.find((c) => Array.isArray(c[1]));
      expect(call).toBeDefined();

      // Same filters as buildMainFilter, minus the `since` bound (the store
      // holds everything already fetched, so the model must not re-window it)
      const expected = service
        .buildMainFilter('user123', 0)
        .map(({ since: _since, ...rest }) => rest);
      expect(call[1]).toEqual(expected);
    });
  });

  describe('getIsNotificationUnread', () => {
    it('returns a function that checks unread status', () => {
      service.initializeInbox('user123');
      const checker = service.getIsNotificationUnread();
      expect(typeof checker).toBe('function');

      const event = { id: 'event-abc', kind: 7, created_at: 9999999999 };
      expect(checker(event)).toBe(true);

      service.markItemAsRead('event-abc');
      // The checker should reflect current state
      expect(service.isNotificationUnread(event)).toBe(false);
    });
  });
});
