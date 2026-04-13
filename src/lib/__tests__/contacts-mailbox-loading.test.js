/**
 * Contacts Store — Bulk Mailbox Loading Tests
 *
 * Tests that loading contacts also bulk-loads kind 10002 (NIP-65 relay lists)
 * for all followed pubkeys, enabling the outbox model to work reactively.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_PUBKEY = 'user123';
const CONTACT_A = 'contact_a_pubkey';
const CONTACT_B = 'contact_b_pubkey';
const CONTACT_C = 'contact_c_pubkey';

// --- Capture what createTimelineLoader receives ---

/** @type {Array<{args: any[], subscribeFn: ReturnType<typeof vi.fn>}>} */
const timelineLoaderCalls = [];

/**
 * Each call to createTimelineLoader records its args and returns a loader
 * that records its subscribe call.
 * @param {any[]} args
 */
function mockCreateTimelineLoader(...args) {
  const subscribeFn = vi.fn(() => ({ unsubscribe: vi.fn() }));
  const entry = { args, subscribeFn };
  timelineLoaderCalls.push(entry);
  return () => ({ subscribe: subscribeFn });
}

/** @type {{ next?: Function } | null} */
let capturedModelHandler = null;

// --- Mocks ---

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => ({
      subscribe: vi.fn((/** @type {any} */ handler) => {
        capturedModelHandler = handler;
        return { unsubscribe: vi.fn() };
      })
    })),
    getReplaceable: vi.fn(() => undefined)
  },
  pool: {}
}));

vi.mock('applesauce-core/models', () => ({
  ContactsModel: class ContactsModel {}
}));

vi.mock('applesauce-core/helpers', () => ({
  getProfileContent: vi.fn(() => undefined)
}));

vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: (/** @type {any[]} */ ...args) => mockCreateTimelineLoader(...args)
}));

vi.mock('$lib/loaders/contact-list-loader.js', () => ({
  createContactListLoader: vi.fn(() => () => () => ({
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  }))
}));

vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn()
}));

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: vi.fn(async () => ['wss://relay.example.com']),
  getRelayListLookupRelays: vi.fn(() => ['wss://purplepag.es', 'wss://relay.nos.social'])
}));

vi.mock('$lib/loaders/profile.js', () => ({
  profileLoader: vi.fn(() => ({
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
  }))
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: vi.fn(() => ['wss://relay.example.com'])
}));

describe('contacts store — bulk mailbox loading', () => {
  /** @type {typeof import('$lib/stores/contacts.svelte.js').contactsStore} */
  let contactsStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedModelHandler = null;
    timelineLoaderCalls.length = 0;

    vi.resetModules();
    const mod = await import('../stores/contacts.svelte.js');
    contactsStore = mod.contactsStore;
  });

  it('bulk-loads kind 10002 for all contacts after kind 3 loads', async () => {
    await contactsStore.loadContacts(USER_PUBKEY);

    // Simulate ContactsModel emitting followed pubkeys
    capturedModelHandler?.next?.([
      { pubkey: CONTACT_A },
      { pubkey: CONTACT_B },
      { pubkey: CONTACT_C }
    ]);

    // Find the createTimelineLoader call for kind 10002
    const mailboxCall = timelineLoaderCalls.find((call) => call.args[2]?.kinds?.[0] === 10002);

    expect(mailboxCall).toBeDefined();
    // Should include all contact pubkeys in the authors filter
    expect(mailboxCall?.args[2].authors).toEqual(
      expect.arrayContaining([CONTACT_A, CONTACT_B, CONTACT_C])
    );
    // Should use relay list lookup relays
    expect(mailboxCall?.args[1]).toEqual(
      expect.arrayContaining(['wss://purplepag.es', 'wss://relay.nos.social'])
    );
  });

  it('subscribes to the mailbox loader', async () => {
    await contactsStore.loadContacts(USER_PUBKEY);
    capturedModelHandler?.next?.([{ pubkey: CONTACT_A }]);

    const mailboxCall = timelineLoaderCalls.find((call) => call.args[2]?.kinds?.[0] === 10002);
    expect(mailboxCall).toBeDefined();
    expect(mailboxCall?.subscribeFn).toHaveBeenCalled();
  });

  it('skips mailbox loading when no contacts', async () => {
    await contactsStore.loadContacts(USER_PUBKEY);
    capturedModelHandler?.next?.([]);

    const mailboxCall = timelineLoaderCalls.find((call) => call.args[2]?.kinds?.[0] === 10002);
    expect(mailboxCall).toBeUndefined();
  });

  it('skips mailbox loading when no lookup relays configured', async () => {
    const { getRelayListLookupRelays } = await import('$lib/services/relay-service.svelte.js');
    vi.mocked(getRelayListLookupRelays).mockReturnValue([]);

    vi.resetModules();
    timelineLoaderCalls.length = 0;
    const mod = await import('../stores/contacts.svelte.js');
    contactsStore = mod.contactsStore;

    await contactsStore.loadContacts(USER_PUBKEY);
    capturedModelHandler?.next?.([{ pubkey: CONTACT_A }]);

    const mailboxCall = timelineLoaderCalls.find((call) => call.args[2]?.kinds?.[0] === 10002);
    expect(mailboxCall).toBeUndefined();
  });

  // Note: cleanup of mailbox subscriptions on clear() is verified by
  // contacts-store.test.js which tests the clear() method comprehensively.
  // The mailbox subscription is pushed to the same activeSubscriptions array.
});
