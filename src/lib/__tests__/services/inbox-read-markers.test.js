// @ts-nocheck
/** @vitest-environment node */
/**
 * Read-marker durability (bell badge jumping back to unread).
 *
 * The NIP-78 kind 30078 marker is the only record of "mark all as read", and
 * it used to be write-only in practice: published to the author's NIP-65 write
 * relays, read back from the lookup relays, mirrored nowhere locally, and
 * overwritten by whatever the event store last emitted. Every test here pins
 * one of the four ways that lost the read state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const noopSub = { unsubscribe: vi.fn() };
const noopObservable = { subscribe: vi.fn(() => noopSub) };

/** Callbacks handed to eventStore.replaceable(...).subscribe() */
let markerCallbacks = [];

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: vi.fn(),
    model: vi.fn(() => noopObservable),
    replaceable: vi.fn(() => ({
      subscribe: (cb) => {
        markerCallbacks.push(cb);
        return noopSub;
      }
    }))
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

const signer = {
  getPublicKey: vi.fn(async () => 'user123'),
  nip44: {
    encrypt: vi.fn(async (_pk, text) => `CIPHER(${text})`),
    decrypt: vi.fn(async (_pk, text) => {
      if (!text.startsWith('CIPHER(')) throw new Error('not nip44 ciphertext');
      return text.slice(7, -1);
    })
  },
  signEvent: vi.fn(async (draft) => ({ ...draft, id: 'signed-id', pubkey: 'user123', sig: 'x' }))
};
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: { active: { signer } } }));

const publishEvent = vi.fn(async () => ({ success: true, relays: [], successCount: 1 }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: (...a) => publishEvent(...a) }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => ['wss://lookup.example'],
  getReadRelays: vi.fn(async () => []),
  getWriteRelays: vi.fn(async () => ['wss://write.example'])
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
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
    raw: () => store
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const MARKERS_KEY = 'comcal:inbox:read-markers:user123';
/** @param {number} t */
const notif = (t) => ({ id: `e${t}`, kind: 7, created_at: t });

describe('inbox read markers', () => {
  /** @type {typeof import('$lib/services/inbox-service.svelte.js')} */
  let service;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    markerCallbacks = [];
    localStorageMock.clear();
    localStorageMock.setItem.mockClear();
    publishEvent.mockClear();
    signer.signEvent.mockClear();
    service = await import('$lib/services/inbox-service.svelte.js');
  });

  afterEach(() => {
    service.cleanup();
    vi.useRealTimers();
  });

  describe('local persistence', () => {
    it('mirrors the markers to localStorage when marking everything read', async () => {
      service.initializeInbox('user123');
      await service.markAsRead();

      const stored = JSON.parse(localStorageMock.raw()[MARKERS_KEY]);
      const now = Math.floor(Date.now() / 1000);
      expect(stored.global).toBe(now);
      expect(stored.reaction).toBe(now);
    });

    it('restores them on the next init without any relay round trip', () => {
      localStorageMock.setItem(MARKERS_KEY, JSON.stringify({ global: 2000 }));

      service.initializeInbox('user123');

      expect(service.getReadMarkers()).toEqual({ global: 2000 });
      expect(service.isNotificationUnread(notif(1500))).toBe(false);
      expect(service.isNotificationUnread(notif(2500))).toBe(true);
    });

    it('ignores a corrupt mirror instead of throwing', () => {
      localStorageMock.setItem(MARKERS_KEY, '{not json');
      expect(() => service.initializeInbox('user123')).not.toThrow();
      expect(service.getReadMarkers()).toBe(null);
    });
  });

  describe('the kind 30078 subscription never downgrades the state', () => {
    /** @param {string} content */
    const emit = async (content) => {
      for (const cb of markerCallbacks) await cb({ kind: 30078, content, pubkey: 'user123' });
    };

    it('keeps the local markers when the relay copy is older', async () => {
      localStorageMock.setItem(MARKERS_KEY, JSON.stringify({ global: 2000, reaction: 2000 }));
      service.initializeInbox('user123');

      await emit(JSON.stringify({ global: 1000, reaction: 1000 }));

      expect(service.getReadMarkers()).toEqual({ global: 2000, reaction: 2000 });
      expect(service.isNotificationUnread(notif(1500))).toBe(false);
    });

    it('takes the newest timestamp per type from either side', async () => {
      localStorageMock.setItem(MARKERS_KEY, JSON.stringify({ global: 2000, reaction: 1000 }));
      service.initializeInbox('user123');

      await emit(JSON.stringify({ global: 1000, reaction: 3000, comment: 4000 }));

      expect(service.getReadMarkers()).toEqual({ global: 2000, reaction: 3000, comment: 4000 });
    });

    it('does not wipe the markers when the content cannot be parsed', async () => {
      localStorageMock.setItem(MARKERS_KEY, JSON.stringify({ global: 2000 }));
      service.initializeInbox('user123');

      await emit('!!! undecryptable garbage !!!');

      expect(service.getReadMarkers()).toEqual({ global: 2000 });
      expect(service.isNotificationUnread(notif(1500))).toBe(false);
    });

    it('decrypts a NIP-44 encrypted marker', async () => {
      service.initializeInbox('user123');

      await emit(`CIPHER(${JSON.stringify({ global: 2000 })})`);

      expect(service.getReadMarkers()).toEqual({ global: 2000 });
    });

    it('writes what it learned back to the local mirror', async () => {
      service.initializeInbox('user123');

      await emit(JSON.stringify({ global: 2000 }));

      expect(JSON.parse(localStorageMock.raw()[MARKERS_KEY])).toEqual({ global: 2000 });
    });
  });

  describe('re-initialization', () => {
    it('is a no-op for the pubkey that is already active', async () => {
      service.initializeInbox('user123');
      await service.markAsRead();
      const markers = service.getReadMarkers();

      service.initializeInbox('user123');

      expect(service.getReadMarkers()).toEqual(markers);
    });

    it('still switches over when a different account logs in', () => {
      localStorageMock.setItem(MARKERS_KEY, JSON.stringify({ global: 2000 }));
      service.initializeInbox('user123');
      expect(service.getReadMarkers()).toEqual({ global: 2000 });

      service.initializeInbox('user456');
      expect(service.getReadMarkers()).toBe(null);
    });
  });

  describe('relay symmetry', () => {
    it('publishes the marker to the lookup relays it is read back from', async () => {
      service.initializeInbox('user123');
      await service.markAsRead();

      expect(publishEvent).toHaveBeenCalled();
      const [, , opts] = publishEvent.mock.calls.at(-1);
      expect(opts?.additionalRelays).toContain('wss://lookup.example');
    });

    it('also looks for the marker on the write relays it was published to', async () => {
      const { addressLoader } = await import('$lib/loaders/base.js');
      addressLoader.mockClear();

      service.initializeInbox('user123');
      await vi.waitFor(() => {
        const call = addressLoader.mock.calls.find(
          (c) => c[0]?.kind === 30078 && c[0]?.relays?.includes('wss://write.example/')
        );
        expect(call).toBeDefined();
      });
    });
  });

  describe('encryption', () => {
    it('encrypts the marker to the user instead of falling back to plaintext', async () => {
      service.initializeInbox('user123');
      await service.markAsRead();

      expect(signer.signEvent).toHaveBeenCalled();
      const draft = signer.signEvent.mock.calls.at(-1)[0];
      expect(draft.content.startsWith('CIPHER(')).toBe(true);
      expect(JSON.parse(draft.content.slice(7, -1)).global).toBe(Math.floor(Date.now() / 1000));
    });

    it('never publishes plaintext when the signer cannot encrypt', async () => {
      signer.nip44.encrypt.mockRejectedValueOnce(new Error('no nip44'));

      service.initializeInbox('user123');
      await service.markAsRead();

      // Read timestamps are activity metadata about the user: without NIP-44
      // they stay on this device (localStorage mirror) and nothing is signed
      // or sent to relays.
      expect(signer.signEvent).not.toHaveBeenCalled();
      expect(publishEvent).not.toHaveBeenCalled();
      const now = Math.floor(Date.now() / 1000);
      expect(service.getReadMarkers()?.global).toBe(now);
      expect(JSON.parse(localStorageMock.raw()[MARKERS_KEY]).global).toBe(now);
    });

    it('keeps the read state locally even when publishing fails outright', async () => {
      publishEvent.mockRejectedValue(new Error('all relays rejected'));

      service.initializeInbox('user123');
      await service.markAsRead();

      const now = Math.floor(Date.now() / 1000);
      expect(service.getReadMarkers()?.global).toBe(now);
      expect(JSON.parse(localStorageMock.raw()[MARKERS_KEY]).global).toBe(now);
      publishEvent.mockResolvedValue({ success: true, relays: [], successCount: 1 });
    });
  });
});
