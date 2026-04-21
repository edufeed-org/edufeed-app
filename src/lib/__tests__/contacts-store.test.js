/**
 * Contacts Store Tests
 *
 * Tests the fix for author search not showing all followed contacts.
 * The root cause was combineLatest blocking on missing profiles.
 * Fix: use applesauce ContactsModel + synchronous EventStore lookups at search time.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock data ---

const USER_PUBKEY = 'user123';
const CONTACT_A = 'contact_a_pubkey';
const CONTACT_B = 'contact_b_pubkey';
const CONTACT_C = 'contact_c_pubkey';

/** @type {Map<string, any>} */
const profileStore = new Map();

// --- Subscription capture helpers ---

/** @type {{ next?: Function, error?: Function, complete?: Function } | null} */
let capturedModelHandler = null;
/** @type {{ next?: Function, error?: Function, complete?: Function } | null} */
let _capturedLoaderHandler = null;

const modelUnsub = vi.fn();
const loaderUnsub = vi.fn();

// --- Mocks ---

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => ({
      subscribe: vi.fn((/** @type {any} */ handler) => {
        capturedModelHandler = handler;
        return { unsubscribe: modelUnsub };
      })
    })),
    getReplaceable: vi.fn((/** @type {number} */ kind, /** @type {string} */ pubkey) => {
      return profileStore.get(pubkey) ?? undefined;
    })
  },
  pool: {}
}));

vi.mock('applesauce-core/models', () => ({
  ContactsModel: class ContactsModel {}
}));

vi.mock('applesauce-core/helpers', () => ({
  getProfileContent: vi.fn((/** @type {any} */ event) => {
    if (!event || !event.content) return undefined;
    try {
      return JSON.parse(event.content);
    } catch {
      return undefined;
    }
  })
}));

vi.mock('$lib/loaders/contact-list-loader.js', () => ({
  createContactListLoader: vi.fn(() => () => () => ({
    subscribe: vi.fn((/** @type {any} */ handler) => {
      _capturedLoaderHandler = handler;
      return { unsubscribe: loaderUnsub };
    })
  }))
}));

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: vi.fn(async () => ['wss://relay.example.com']),
  getRelayListLookupRelays: vi.fn(() => ['wss://purplepag.es'])
}));

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: vi.fn(() => () => ({
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  }))
}));

vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn()
}));

vi.mock('$lib/loaders/profile.js', () => ({
  profileLoader: vi.fn(() => ({
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  }))
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: vi.fn(() => ['wss://relay.example.com']),
  getEventLoaderLookupRelays: () => []
}));

// Helper to create a kind 0 event
/** @param {string} pubkey @param {Record<string, any>} profile */
function makeProfileEvent(pubkey, profile) {
  return {
    id: `profile_${pubkey}`,
    kind: 0,
    pubkey,
    content: JSON.stringify(profile),
    created_at: 1700000000,
    tags: []
  };
}

describe('contacts-store', () => {
  /** @type {typeof import('$lib/stores/contacts.svelte.js').contactsStore} */
  let contactsStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    profileStore.clear();
    capturedModelHandler = null;
    _capturedLoaderHandler = null;

    // Fresh import for each test (reset module state)
    vi.resetModules();
    const mod = await import('../stores/contacts.svelte.js');
    contactsStore = mod.contactsStore;
  });

  describe('loadContacts', () => {
    it('sets contacts to followed pubkeys when kind 3 loads (no profile blocking)', async () => {
      await contactsStore.loadContacts(USER_PUBKEY);

      // Simulate ContactsModel emitting ProfilePointer[] (just pubkeys)
      capturedModelHandler?.next?.([
        { pubkey: CONTACT_A },
        { pubkey: CONTACT_B },
        { pubkey: CONTACT_C }
      ]);

      expect(contactsStore.contacts).toHaveLength(3);
      expect(contactsStore.isLoaded).toBe(true);
      expect(contactsStore.isLoading).toBe(false);
    });

    it('sets contacts even when no profiles have loaded yet', async () => {
      // No profiles in EventStore at all
      await contactsStore.loadContacts(USER_PUBKEY);

      capturedModelHandler?.next?.([{ pubkey: CONTACT_A }, { pubkey: CONTACT_B }]);

      // contacts should reflect pubkeys immediately, not wait for profiles
      expect(contactsStore.contacts).toHaveLength(2);
      expect(contactsStore.isLoaded).toBe(true);
    });
  });

  describe('searchContacts', () => {
    async function setupWithContacts() {
      await contactsStore.loadContacts(USER_PUBKEY);
      capturedModelHandler?.next?.([
        { pubkey: CONTACT_A },
        { pubkey: CONTACT_B },
        { pubkey: CONTACT_C }
      ]);
    }

    it('returns matches for contacts whose profiles are in EventStore', async () => {
      profileStore.set(
        CONTACT_A,
        makeProfileEvent(CONTACT_A, {
          name: 'alice',
          display_name: 'Alice Wonderland',
          picture: 'https://example.com/alice.jpg'
        })
      );
      profileStore.set(
        CONTACT_B,
        makeProfileEvent(CONTACT_B, {
          name: 'bob',
          display_name: 'Bob Builder'
        })
      );

      await setupWithContacts();

      const results = contactsStore.searchContacts('alice');
      expect(results).toHaveLength(1);
      expect(results[0].pubkey).toBe(CONTACT_A);
      expect(results[0].name).toBe('alice');
      expect(results[0].display_name).toBe('Alice Wonderland');
    });

    it('matches on display_name', async () => {
      profileStore.set(
        CONTACT_A,
        makeProfileEvent(CONTACT_A, {
          name: 'al',
          display_name: 'Alice Wonderland'
        })
      );

      await setupWithContacts();

      const results = contactsStore.searchContacts('wonderland');
      expect(results).toHaveLength(1);
      expect(results[0].pubkey).toBe(CONTACT_A);
    });

    it('returns results even when some profiles are missing (no blocking)', async () => {
      // Only CONTACT_A has a profile; B and C do not
      profileStore.set(
        CONTACT_A,
        makeProfileEvent(CONTACT_A, {
          name: 'alice',
          display_name: 'Alice'
        })
      );

      await setupWithContacts();

      const results = contactsStore.searchContacts('alice');
      expect(results).toHaveLength(1);
      expect(results[0].pubkey).toBe(CONTACT_A);

      // Search for something that would match a missing profile — gracefully empty
      const noResults = contactsStore.searchContacts('bob');
      expect(noResults).toHaveLength(0);
    });

    it('returns empty for search terms shorter than 2 characters', async () => {
      profileStore.set(CONTACT_A, makeProfileEvent(CONTACT_A, { name: 'alice' }));

      await setupWithContacts();

      expect(contactsStore.searchContacts('a')).toHaveLength(0);
      expect(contactsStore.searchContacts('')).toHaveLength(0);
    });

    it('respects the limit parameter', async () => {
      profileStore.set(CONTACT_A, makeProfileEvent(CONTACT_A, { name: 'test user a' }));
      profileStore.set(CONTACT_B, makeProfileEvent(CONTACT_B, { name: 'test user b' }));
      profileStore.set(CONTACT_C, makeProfileEvent(CONTACT_C, { name: 'test user c' }));

      await setupWithContacts();

      const results = contactsStore.searchContacts('test', 2);
      expect(results).toHaveLength(2);
    });

    it('is case-insensitive', async () => {
      profileStore.set(
        CONTACT_A,
        makeProfileEvent(CONTACT_A, {
          name: 'Alice',
          display_name: 'ALICE WONDERLAND'
        })
      );

      await setupWithContacts();

      expect(contactsStore.searchContacts('alice')).toHaveLength(1);
      expect(contactsStore.searchContacts('ALICE')).toHaveLength(1);
      expect(contactsStore.searchContacts('Alice')).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('resets contacts and state', async () => {
      await contactsStore.loadContacts(USER_PUBKEY);
      capturedModelHandler?.next?.([{ pubkey: CONTACT_A }]);

      expect(contactsStore.contacts).toHaveLength(1);

      contactsStore.clear();

      expect(contactsStore.contacts).toHaveLength(0);
      expect(contactsStore.isLoaded).toBe(false);
      expect(contactsStore.isLoading).toBe(false);
    });
  });
});
