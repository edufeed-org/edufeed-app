// @ts-nocheck
/** @vitest-environment node */
/**
 * inbox-service's membership-application collision guard (Plan 5 Task 1,
 * item 7). A community's own application form (community-application.js)
 * can share the exact same 30168 address as the deployment's membership
 * form when a community reuses that template — isMembershipApplication only
 * matches on the `a` tag, so it can't tell the two apart on its own.
 * `mainNotifications`'s derived filter (inbox-service.svelte.js) resolves
 * the ambiguity by pubkey: only hide the response when it is p-tagged to a
 * CONFIGURED DEPLOYMENT ADMIN (a real membership application); the same
 * form address p-tagged to anyone else (e.g. a community's root-group
 * reviewer) stays visible, since there is no separate group-application
 * inbox yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const FORM_ADDRESS = '30168:' + 'a'.repeat(64) + ':edufeed-membership';
const ADMIN_PUBKEY = 'd'.repeat(64);
const REVIEWER_PUBKEY = 'e'.repeat(64);
const APPLICANT_PUBKEY = 'f'.repeat(64);
// The inbox being checked belongs to this viewer — distinct from the
// applicant (event author) so filterSelfNotifications' self-authored filter
// never interferes with the collision-guard behavior under test.
const VIEWER_PUBKEY = 'c'.repeat(64);

const noopSub = { unsubscribe: vi.fn() };
const noopObservable = { subscribe: vi.fn(() => noopSub) };

/** Mutable knob the individual tests flip before initializeInbox(). */
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

// eventStore.model is called for several things (main notifications,
// calendar events, polls); only the call with an ARRAY filter (the main
// notification model) matters here — mirrors the same distinction the
// "event store model subscription" test in inbox-service.test.js relies on.
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
  getReadRelays: vi.fn(async () => [])
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

/** @param {string} id @param {string[][]} tags */
function membershipResponse(id, tags) {
  return { id, kind: 1069, pubkey: APPLICANT_PUBKEY, created_at: 1_700_000_000, content: '', tags };
}

describe('inbox-service — membership-application collision guard', () => {
  /** @type {typeof import('$lib/services/inbox-service.svelte.js')} */
  let service;

  beforeEach(async () => {
    vi.resetModules();
    localStorageMock.clear();
    membershipConfig.formAddress = FORM_ADDRESS;
    membershipConfig.adminPubkeys = [ADMIN_PUBKEY];
    membershipConfig.__events = [];
    service = await import('$lib/services/inbox-service.svelte.js');
  });

  it('hides a 1069 for the membership form address when p-tagged to a configured admin', () => {
    const adminTagged = membershipResponse('resp-admin', [
      ['a', FORM_ADDRESS],
      ['p', ADMIN_PUBKEY]
    ]);
    membershipConfig.__events = [adminTagged];

    service.initializeInbox(VIEWER_PUBKEY);

    expect(service.getNotifications().map((e) => e.id)).not.toContain('resp-admin');
  });

  it('keeps the same form address visible when p-tagged to a non-admin (community reviewer)', () => {
    const reviewerTagged = membershipResponse('resp-reviewer', [
      ['a', FORM_ADDRESS],
      ['p', REVIEWER_PUBKEY]
    ]);
    membershipConfig.__events = [reviewerTagged];

    service.initializeInbox(VIEWER_PUBKEY);

    expect(service.getNotifications().map((e) => e.id)).toContain('resp-reviewer');
  });
});
