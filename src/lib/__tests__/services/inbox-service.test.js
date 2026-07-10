// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before import
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn(), model: vi.fn(), replaceable: vi.fn() }
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  addressLoader: vi.fn(),
  eventLoader: vi.fn()
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay1'],
  getCalendarRelays: () => ['wss://relay2'],
  getEducationalRelays: () => ['wss://relay3'],
  getNotificationFallbackRelays: () => ['wss://fallback1', 'wss://relay1'],
  getAllLookupRelays: () => ['wss://lookup1'],
  getEventLoaderLookupRelays: () => []
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn()
}));
vi.mock('applesauce-core/models', () => ({
  TimelineModel: 'TimelineModel'
}));
vi.mock('applesauce-common/blueprints', () => ({
  AppDataBlueprint: vi.fn()
}));
vi.mock('applesauce-core/event-factory', () => ({
  EventFactory: vi.fn()
}));
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({}))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: null }
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn()
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  parseAddressPointerFromATag: vi.fn()
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => []
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getUnreadDmCount: () => 0,
  markAllDmConversationsAsRead: vi.fn()
}));

describe('inbox-service pure functions', () => {
  let buildMainFilter, getNotificationRelays, getSupplementalNotificationRelays, parseReadMarkers;

  beforeEach(async () => {
    const mod = await import('$lib/services/inbox-service.svelte.js');
    buildMainFilter = mod.buildMainFilter;
    getNotificationRelays = mod.getNotificationRelays;
    getSupplementalNotificationRelays = mod.getSupplementalNotificationRelays;
    parseReadMarkers = mod.parseReadMarkers;
  });

  describe('buildMainFilter', () => {
    it('creates combined filter array with #p and #P', () => {
      const filters = buildMainFilter('userpubkey', 1000);
      expect(filters).toEqual([
        { kinds: [1070, 1069, 7, 9], '#p': ['userpubkey'], since: 1000 },
        { kinds: [1111], '#p': ['userpubkey'], since: 1000 },
        { kinds: [1111], '#P': ['userpubkey'], since: 1000 }
      ]);
    });
  });

  describe('getNotificationRelays', () => {
    it('returns deduplicated union of communikey + calendar + educational + fallback relays', () => {
      const relays = getNotificationRelays();
      expect(relays).toContain('wss://relay1');
      expect(relays).toContain('wss://relay2');
      expect(relays).toContain('wss://relay3');
      // Fallback relays are always included (even in gated mode) so
      // notifications published by external clients are found (issue #43)
      expect(relays).toContain('wss://fallback1');
      expect(relays).toHaveLength(4);
    });
  });

  describe('getSupplementalNotificationRelays', () => {
    it('returns read relays not already covered by the base set', () => {
      const result = getSupplementalNotificationRelays(
        ['wss://relay1', 'wss://relay2'],
        ['wss://user-inbox.example', 'wss://relay1']
      );
      expect(result).toEqual(['wss://user-inbox.example/']);
    });

    it('treats trailing-slash and case variants as the same relay', () => {
      const result = getSupplementalNotificationRelays(
        ['wss://relay1'],
        ['wss://Relay1/', 'wss://relay1']
      );
      expect(result).toEqual([]);
    });

    it('deduplicates the returned supplemental relays', () => {
      const result = getSupplementalNotificationRelays(
        [],
        ['wss://user-inbox.example', 'wss://user-inbox.example/']
      );
      expect(result).toEqual(['wss://user-inbox.example/']);
    });

    it('ignores invalid relay URLs', () => {
      const result = getSupplementalNotificationRelays(['wss://relay1'], ['not a url', '']);
      expect(result).toEqual([]);
    });
  });

  describe('parseReadMarkers', () => {
    it('parses valid JSON', () => {
      const result = parseReadMarkers('{"global":1000,"formRequest":1100}');
      expect(result).toEqual({ global: 1000, formRequest: 1100 });
    });
    it('returns null for invalid JSON', () => {
      expect(parseReadMarkers('not json')).toBe(null);
    });
    it('returns null for null input', () => {
      expect(parseReadMarkers(null)).toBe(null);
    });
  });
});
