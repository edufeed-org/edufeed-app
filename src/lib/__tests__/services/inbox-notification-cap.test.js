// @ts-nocheck
/** @vitest-environment node */
/**
 * The inbox's main TimelineModel has no limit and the live subscription keeps
 * feeding it, so a long session would re-filter an ever-growing list on every
 * new event. Only the newest MAX_INBOX_NOTIFICATIONS are processed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const VIEWER_PUBKEY = 'c'.repeat(64);
const OTHER_PUBKEY = 'f'.repeat(64);

const noopSub = { unsubscribe: vi.fn() };
const noopObservable = { subscribe: vi.fn(() => noopSub) };

/** Events the main notification model replays. */
const membershipConfig = vi.hoisted(() => ({
  formAddress: /** @type {string | null} */ (null),
  adminPubkeys: /** @type {string[]} */ ([])
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  get runtimeConfig() {
    return {
      membership: {
        formAddress: membershipConfig.formAddress,
        adminPubkeys: membershipConfig.adminPubkeys
      }
    };
  }
}));

// Only the model call with an ARRAY filter is the main notification model.
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: vi.fn(),
    model: vi.fn((/** @type {any} */ _Model, /** @type {any} */ filters) => {
      if (!Array.isArray(filters)) return noopObservable;
      return {
        subscribe: (/** @type {(v: any) => void} */ cb) => {
          cb(membershipConfig.__events || []);
          return noopSub;
        }
      };
    }),
    replaceable: vi.fn(() => noopObservable)
  },
  pool: { group: vi.fn(() => ({ subscription: vi.fn(() => noopObservable) })) }
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  fetchEvents: vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) })),
  addressLoader: vi.fn(() => noopObservable),
  eventLoader: vi.fn(() => noopObservable)
}));
vi.mock('$lib/loaders/profile-badges.js', () => ({
  loadProfileBadgeLists: () => ({ subscribe: () => ({ unsubscribe() {} }) })
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay1'],
  getCalendarRelays: () => ['wss://relay2'],
  getEducationalRelays: () => ['wss://relay3'],
  getNotificationFallbackRelays: () => [],
  getAllLookupRelays: () => ['wss://lookup1'],
  getEventLoaderLookupRelays: () => [],
  getGroupsRelays: () => []
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
  getReadRelays: vi.fn(async () => []),
  getWriteRelays: vi.fn(async () => [])
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getUnreadDmCount: () => 0,
  markAllDmConversationsAsRead: vi.fn()
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  parseAddressPointerFromATag: vi.fn()
}));

const localStorageMock = (() => {
  /** @type {Record<string, string>} */
  let store = {};
  return {
    getItem: vi.fn((/** @type {string} */ key) => store[key] ?? null),
    setItem: vi.fn((/** @type {string} */ key, /** @type {string} */ value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((/** @type {string} */ key) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    }
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

describe('inbox-service — notification cap', () => {
  /** @type {typeof import('$lib/services/inbox-service.svelte.js')} */
  let service;

  beforeEach(async () => {
    vi.resetModules();
    localStorageMock.clear();
    service = await import('$lib/services/inbox-service.svelte.js');
  });

  it('processes only the newest notifications the model holds', () => {
    // TimelineModel emits newest first and has no limit; the live leg keeps
    // adding to it for as long as the app is open.
    membershipConfig.__events = Array.from({ length: 700 }, (_, i) => ({
      id: `n${i}`,
      kind: 7,
      pubkey: OTHER_PUBKEY,
      created_at: 1_700_000_000 - i,
      content: '+',
      tags: [['p', VIEWER_PUBKEY]]
    }));
    service.initializeInbox(VIEWER_PUBKEY);

    const ids = service.getNotifications().map((e) => e.id);
    expect(ids).toHaveLength(service.MAX_INBOX_NOTIFICATIONS);
    expect(ids).toContain('n0');
    expect(ids).not.toContain('n699');
  });
});
