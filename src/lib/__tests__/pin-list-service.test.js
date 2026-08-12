/** @vitest-environment node */
/**
 * pin-list-service — kind 10001 pin lists, keyed by an explicit ownerPubkey.
 *
 * Writes must sign with getCommunitySigner(ownerPubkey), never the active
 * account directly — a community run from a separate keypair (the owner's
 * personal account, with the community's key ALSO imported into the
 * manager) must still publish pin-list events under the COMMUNITY's pubkey,
 * signed by the community's own signer, not the active account's (handoff
 * #12; see also getCommunitySigner's own unit test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEventStore = {
  getReplaceable: vi.fn(),
  add: vi.fn()
};

const mockPublishEvent = vi.fn().mockResolvedValue(undefined);

// Templates flow through build/modify/sign unmodified (spread), so the
// `pubkey` the service puts on the template survives to the "signed" event —
// letting tests assert the final signed event's pubkey.
const mockFactory = {
  modify: vi.fn(async (/** @type {any} */ event, ..._ops) => ({ ...event })),
  build: vi.fn(async (/** @type {any} */ template, ..._ops) => ({ ...template })),
  sign: vi.fn(async (/** @type {any} */ draft) => ({ ...draft, sig: 'fakesig', id: 'signedid' }))
};
const mockCreateAppEventFactory = vi.fn((/** @type {any} */ _opts) => mockFactory);

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: (/** @type {any} */ opts) => mockCreateAppEventFactory(opts)
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: mockEventStore
}));

const COMMUNITY_PK = 'aa'.repeat(32);
// A separate personal keypair: distinct from the community, but the manager
// ALSO holds an account registered under the community's own pubkey (the
// "community key imported alongside a personal login" scenario).
const ACTIVE_PK = 'dd'.repeat(32);

const communitySigner = { role: 'community' };
const activeSigner = { role: 'active' };

/** @type {Map<string, {pubkey: string, signer: any}>} */
let accounts;
const mockManager = vi.hoisted(() => ({
  /** @type {any} */ active: null,
  /** @type {Map<string, any> | undefined} */ __accounts: undefined,
  getAccountForPubkey(/** @type {string} */ pk) {
    return this.__accounts?.get(pk);
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => mockPublishEvent(...args)
}));

// Must import AFTER mocks. community-signer.js is NOT mocked — this test
// exercises the real getCommunitySigner()/isCommunityOwner() against the
// mocked manager, same as the service does in production.
const { pinEvent, unpinEvent, isPinned, reorderPins } = await import(
  '$lib/services/pin-list-service.js'
);

/** @type {import('nostr-tools').NostrEvent} */
const regularEvent = /** @type {any} */ ({
  id: 'event123',
  kind: 1,
  pubkey: 'bb'.repeat(32),
  tags: [],
  content: 'hello',
  created_at: 1700000000
});

/** @type {import('nostr-tools').NostrEvent} */
const addressableEvent = /** @type {any} */ ({
  id: 'event456',
  kind: 30023,
  pubkey: 'cc'.repeat(32),
  tags: [['d', 'my-article']],
  content: 'article content',
  created_at: 1700000000
});

describe('pin-list-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventStore.getReplaceable.mockReturnValue(null);
    // Separate-keypair default: active account is a personal key, distinct
    // from the community, but the manager also holds a signer for the
    // community's own pubkey (imported alongside the personal login).
    accounts = new Map([
      [ACTIVE_PK, { pubkey: ACTIVE_PK, signer: activeSigner }],
      [COMMUNITY_PK, { pubkey: COMMUNITY_PK, signer: communitySigner }]
    ]);
    mockManager.active = { pubkey: ACTIVE_PK, signer: activeSigner };
    mockManager.__accounts = accounts;
  });

  describe('pinEvent', () => {
    it('signs with the COMMUNITY signer, not the active account, and stamps the community pubkey', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      await pinEvent(regularEvent, COMMUNITY_PK);

      // createAppEventFactory got the community's signer, not the active one.
      expect(mockCreateAppEventFactory).toHaveBeenCalledWith({ signer: communitySigner });
      // The signed event carries the community's pubkey.
      const signedEvent = await mockFactory.sign.mock.results[0].value;
      expect(signedEvent.pubkey).toBe(COMMUNITY_PK);
      expect(mockFactory.build).toHaveBeenCalled();
      expect(mockFactory.modify).not.toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
      expect(mockEventStore.add).toHaveBeenCalled();
    });

    it('creates new kind 10001 when none exists', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      await pinEvent(regularEvent, COMMUNITY_PK);
      expect(mockFactory.build).toHaveBeenCalled();
      expect(mockFactory.modify).not.toHaveBeenCalled();
      expect(mockFactory.sign).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
      expect(mockEventStore.add).toHaveBeenCalled();
    });

    it('modifies existing kind 10001 when it exists', async () => {
      const existing = { kind: 10001, tags: [], content: '', created_at: 1699999999 };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      await pinEvent(regularEvent, COMMUNITY_PK);
      expect(mockFactory.modify).toHaveBeenCalledWith(existing, expect.any(Function));
      expect(mockFactory.build).not.toHaveBeenCalled();
    });

    it('pins addressable event using addAddressPointerTag', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      await pinEvent(addressableEvent, COMMUNITY_PK);
      expect(mockFactory.build).toHaveBeenCalled();
      expect(mockFactory.sign).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('rejects duplicate pins', async () => {
      const existing = {
        kind: 10001,
        tags: [['e', 'event123']],
        content: '',
        created_at: 1699999999
      };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      await expect(pinEvent(regularEvent, COMMUNITY_PK)).rejects.toThrow(/already pinned/i);
    });

    it('rejects when the manager holds no signer for the owner pubkey', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      const strangerPk = 'ee'.repeat(32);
      await expect(pinEvent(regularEvent, strangerPk)).rejects.toThrow(/no signer/i);
      expect(mockPublishEvent).not.toHaveBeenCalled();
    });

    it('the personal-profile case (ownerPubkey === active account pubkey) signs with the active signer', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      await pinEvent(regularEvent, ACTIVE_PK);
      expect(mockCreateAppEventFactory).toHaveBeenCalledWith({ signer: activeSigner });
    });
  });

  describe('unpinEvent', () => {
    it('modifies existing pin list to remove regular event', async () => {
      const existing = {
        kind: 10001,
        tags: [['e', 'event123']],
        content: '',
        created_at: 1699999999
      };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      await unpinEvent(regularEvent, COMMUNITY_PK);
      expect(mockFactory.modify).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('modifies existing pin list to remove addressable event', async () => {
      const existing = {
        kind: 10001,
        tags: [['a', `30023:${'cc'.repeat(32)}:my-article`]],
        content: '',
        created_at: 1699999999
      };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      await unpinEvent(addressableEvent, COMMUNITY_PK);
      expect(mockFactory.modify).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('rejects when the manager holds no signer for the owner pubkey', async () => {
      const existing = {
        kind: 10001,
        tags: [['e', 'event123']],
        content: '',
        created_at: 1699999999
      };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      const strangerPk = 'ee'.repeat(32);
      await expect(unpinEvent(regularEvent, strangerPk)).rejects.toThrow(/no signer/i);
    });
  });

  describe('isPinned', () => {
    it('returns false when no pin list exists', () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      expect(isPinned(regularEvent, COMMUNITY_PK)).toBe(false);
    });

    it('returns true for pinned regular event (e tag)', () => {
      const pinList = {
        kind: 10001,
        tags: [['e', 'event123']],
        content: ''
      };
      mockEventStore.getReplaceable.mockReturnValue(pinList);
      expect(isPinned(regularEvent, COMMUNITY_PK)).toBe(true);
    });

    it('returns true for pinned addressable event (a tag)', () => {
      const pinList = {
        kind: 10001,
        tags: [['a', `30023:${'cc'.repeat(32)}:my-article`]],
        content: ''
      };
      mockEventStore.getReplaceable.mockReturnValue(pinList);
      expect(isPinned(addressableEvent, COMMUNITY_PK)).toBe(true);
    });

    it('returns false for non-pinned event', () => {
      const pinList = {
        kind: 10001,
        tags: [['e', 'other-event']],
        content: ''
      };
      mockEventStore.getReplaceable.mockReturnValue(pinList);
      expect(isPinned(regularEvent, COMMUNITY_PK)).toBe(false);
    });
  });

  describe('reorderPins', () => {
    it('swaps tags at correct indices', async () => {
      const existing = {
        kind: 10001,
        tags: [
          ['e', 'first'],
          ['e', 'second'],
          ['e', 'third']
        ],
        content: '',
        created_at: 1700000000
      };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      await reorderPins(COMMUNITY_PK, 0, 2);
      expect(mockFactory.build).toHaveBeenCalled();
      const buildArgs = mockFactory.build.mock.calls[0][0];
      // Tags should be swapped: third, second, first
      expect(buildArgs.tags[0][1]).toBe('third');
      expect(buildArgs.tags[2][1]).toBe('first');
      expect(mockFactory.sign).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('signs with the COMMUNITY signer, not the active account', async () => {
      const existing = {
        kind: 10001,
        tags: [
          ['e', 'first'],
          ['e', 'second']
        ],
        content: '',
        created_at: 1700000000
      };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      await reorderPins(COMMUNITY_PK, 0, 1);
      expect(mockCreateAppEventFactory).toHaveBeenCalledWith({ signer: communitySigner });
      const signedEvent = await mockFactory.sign.mock.results[0].value;
      expect(signedEvent.pubkey).toBe(COMMUNITY_PK);
    });

    it('throws when no pin list exists', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      await expect(reorderPins(COMMUNITY_PK, 0, 1)).rejects.toThrow(/no pin list/i);
    });

    it('rejects when the manager holds no signer for the owner pubkey', async () => {
      const existing = {
        kind: 10001,
        tags: [
          ['e', 'first'],
          ['e', 'second']
        ],
        content: '',
        created_at: 1700000000
      };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      const strangerPk = 'ee'.repeat(32);
      await expect(reorderPins(strangerPk, 0, 1)).rejects.toThrow(/no signer/i);
    });
  });
});
