/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEventStore = {
  getReplaceable: vi.fn(),
  add: vi.fn()
};

const mockPublishEvent = vi.fn().mockResolvedValue(undefined);

const mockSigner = { sign: vi.fn((e) => Promise.resolve({ ...e, sig: 'fakesig' })) };
const mockManager = {
  active: { pubkey: 'aa'.repeat(32), signer: mockSigner }
};

// Mock factory.modify, factory.build, and factory.sign
const mockModifiedEvent = { kind: 10001, tags: [], content: '', created_at: 1700000000 };
const mockSignedEvent = { ...mockModifiedEvent, sig: 'fakesig', id: 'signedid' };
const mockFactory = {
  modify: vi.fn().mockResolvedValue(mockModifiedEvent),
  build: vi.fn().mockResolvedValue(mockModifiedEvent),
  sign: vi.fn().mockResolvedValue(mockSignedEvent)
};

vi.mock('applesauce-core/event-factory', () => ({
  EventFactory: vi.fn(function () {
    return mockFactory;
  })
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => mockFactory)
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: mockEventStore
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => mockPublishEvent(...args)
}));

// Must import AFTER mocks
const { pinEvent, unpinEvent, isPinned, reorderPins } = await import(
  '$lib/services/pin-list-service.js'
);

const communityPubkey = 'aa'.repeat(32);

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
  });

  describe('pinEvent', () => {
    it('creates new kind 10001 when none exists', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      await pinEvent(regularEvent);
      expect(mockFactory.build).toHaveBeenCalled();
      expect(mockFactory.modify).not.toHaveBeenCalled();
      expect(mockFactory.sign).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
      expect(mockEventStore.add).toHaveBeenCalled();
    });

    it('modifies existing kind 10001 when it exists', async () => {
      const existing = { kind: 10001, tags: [], content: '', created_at: 1699999999 };
      mockEventStore.getReplaceable.mockReturnValue(existing);
      await pinEvent(regularEvent);
      expect(mockFactory.modify).toHaveBeenCalledWith(existing, expect.any(Function));
      expect(mockFactory.build).not.toHaveBeenCalled();
    });

    it('pins addressable event using addAddressPointerTag', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      await pinEvent(addressableEvent);
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
      await expect(pinEvent(regularEvent)).rejects.toThrow(/already pinned/i);
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
      await unpinEvent(regularEvent);
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
      await unpinEvent(addressableEvent);
      expect(mockFactory.modify).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
    });
  });

  describe('isPinned', () => {
    it('returns false when no pin list exists', () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      expect(isPinned(regularEvent, communityPubkey)).toBe(false);
    });

    it('returns true for pinned regular event (e tag)', () => {
      const pinList = {
        kind: 10001,
        tags: [['e', 'event123']],
        content: ''
      };
      mockEventStore.getReplaceable.mockReturnValue(pinList);
      expect(isPinned(regularEvent, communityPubkey)).toBe(true);
    });

    it('returns true for pinned addressable event (a tag)', () => {
      const pinList = {
        kind: 10001,
        tags: [['a', `30023:${'cc'.repeat(32)}:my-article`]],
        content: ''
      };
      mockEventStore.getReplaceable.mockReturnValue(pinList);
      expect(isPinned(addressableEvent, communityPubkey)).toBe(true);
    });

    it('returns false for non-pinned event', () => {
      const pinList = {
        kind: 10001,
        tags: [['e', 'other-event']],
        content: ''
      };
      mockEventStore.getReplaceable.mockReturnValue(pinList);
      expect(isPinned(regularEvent, communityPubkey)).toBe(false);
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
      await reorderPins(communityPubkey, 0, 2);
      expect(mockFactory.build).toHaveBeenCalled();
      const buildArgs = mockFactory.build.mock.calls[0][0];
      // Tags should be swapped: third, second, first
      expect(buildArgs.tags[0][1]).toBe('third');
      expect(buildArgs.tags[2][1]).toBe('first');
      expect(mockFactory.sign).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('throws when no pin list exists', async () => {
      mockEventStore.getReplaceable.mockReturnValue(null);
      await expect(reorderPins(communityPubkey, 0, 1)).rejects.toThrow(/no pin list/i);
    });
  });
});
