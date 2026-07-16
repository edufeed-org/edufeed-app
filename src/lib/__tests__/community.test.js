/**
 * Unit tests for ensureFollowSetExists in src/lib/helpers/community.js
 *
 * Goal: clicking "Folgen" on a community should not block on a relay round-trip,
 * even on the very first follow of a session (when no kind 30000 follow set
 * with d="communities" exists yet locally).
 *
 * The contract under test:
 *   1. If the follow set is already in EventStore, the helper does a synchronous
 *      lookup and returns immediately — no signing, no publishing.
 *   2. If absent locally, the helper must CONFIRM absence against the network
 *      (IDB cache + lookup relays + the user's NIP-65 write relays) before
 *      bootstrapping — a kind 30000 with a newer created_at REPLACES the old
 *      list on every relay, so creating an empty set on a mere local-cache
 *      miss destroys the user's memberships (2026-07-16 incident).
 *   3. Only when the network confirms absence: sign an empty follow set,
 *      insert it into EventStore synchronously, and fire `publishEvent` in the
 *      background WITHOUT awaiting it.
 *   4. Background publish failures must not throw — the local optimistic state
 *      stays valid even when relays reject.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Module mocks --------------------------------------------------------

const mockGetReplaceable = vi.fn();
const mockEventStoreAdd = vi.fn();
const mockReplaceableSubscribe = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getReplaceable: (/** @type {any[]} */ ...args) => mockGetReplaceable(...args),
    add: (/** @type {any} */ event) => mockEventStoreAdd(event),
    replaceable: (/** @type {any[]} */ ...args) => ({
      subscribe: (/** @type {any} */ cb) => mockReplaceableSubscribe(cb, ...args)
    })
  }
}));

const mockAddressLoader = vi.fn();

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: (/** @type {any} */ pointer) => mockAddressLoader(pointer)
}));

const mockGetAllLookupRelays = vi.fn(() => ['wss://lookup.example']);

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => mockGetAllLookupRelays()
}));

const mockGetWriteRelays = vi.fn(async (/** @type {string} */ _pubkey) => ['wss://write.example']);

vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getWriteRelays: (/** @type {string} */ pubkey) => mockGetWriteRelays(pubkey)
}));

const TEST_PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';

const mockManager = {
  /** @type {{ pubkey: string, signer: any } | null} */
  active: {
    pubkey: TEST_PUBKEY,
    signer: { signEvent: vi.fn() }
  }
};

vi.mock('$lib/stores/accounts.svelte', () => ({
  get manager() {
    return mockManager;
  }
}));

const mockBuild = vi.fn();
const mockSign = vi.fn();

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    build: (/** @type {any} */ template) => mockBuild(template),
    sign: (/** @type {any} */ template) => mockSign(template)
  })
}));

const mockPublishEvent = vi.fn();

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => mockPublishEvent(...args)
}));

// actionRunnerOptimistic is imported by community.js but only used by
// joinCommunity/leaveCommunity, not by ensureFollowSetExists. Stub it so the
// module loads.
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run: vi.fn() }
}));

// Import AFTER mocks are wired up.
const { ensureFollowSetExists } = await import('../helpers/community.js');

// --- Helpers --------------------------------------------------------------

const SIGNED_FOLLOW_SET = {
  id: 'fake-id',
  kind: 30000,
  pubkey: TEST_PUBKEY,
  tags: [['d', 'communities']],
  content: '',
  created_at: 1234567890,
  sig: 'fake-sig'
};

/** Observable-like whose subscribe immediately signals completion (EOSE everywhere, no event). */
const completedLoader = () => ({
  subscribe: (/** @type {any} */ observer) => {
    observer?.complete?.();
    return { unsubscribe: () => {} };
  }
});

/** Observable-like that never emits and never completes (hanging relay). */
const hangingLoader = () => ({
  subscribe: () => ({ unsubscribe: () => {} })
});

beforeEach(() => {
  vi.clearAllMocks();
  mockManager.active = {
    pubkey: TEST_PUBKEY,
    signer: { signEvent: vi.fn() }
  };
  mockBuild.mockResolvedValue({
    kind: 30000,
    pubkey: TEST_PUBKEY,
    tags: [['d', 'communities']],
    content: '',
    created_at: 1234567890
  });
  mockSign.mockResolvedValue(SIGNED_FOLLOW_SET);
  // Default: publish never resolves — proves we don't await it.
  mockPublishEvent.mockReturnValue(new Promise(() => {}));
  // Default network check: EventStore subscription emits "nothing yet",
  // loader completes without finding the event → absence confirmed.
  mockReplaceableSubscribe.mockImplementation((/** @type {any} */ cb) => {
    cb(undefined);
    return { unsubscribe: () => {} };
  });
  mockAddressLoader.mockImplementation(() => completedLoader());
  mockGetAllLookupRelays.mockReturnValue(['wss://lookup.example']);
  mockGetWriteRelays.mockResolvedValue(['wss://write.example']);
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests ----------------------------------------------------------------

describe('ensureFollowSetExists', () => {
  it('returns immediately without signing or publishing when the follow set already exists', async () => {
    mockGetReplaceable.mockReturnValue(SIGNED_FOLLOW_SET);

    await ensureFollowSetExists();

    expect(mockGetReplaceable).toHaveBeenCalledWith(30000, TEST_PUBKEY, 'communities');
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(mockEventStoreAdd).not.toHaveBeenCalled();
  });

  it('is a no-op when no user is active', async () => {
    mockManager.active = null;

    await ensureFollowSetExists();

    expect(mockGetReplaceable).not.toHaveBeenCalled();
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('signs an empty follow set, adds it to EventStore, and fires publish without awaiting it', async () => {
    mockGetReplaceable.mockReturnValue(undefined);

    // publishEvent never resolves — if ensureFollowSetExists awaited it, this
    // test would hang and time out. The fact that it returns proves the
    // background-publish contract.
    let publishStarted = false;
    mockPublishEvent.mockImplementation(() => {
      publishStarted = true;
      return new Promise(() => {});
    });

    await ensureFollowSetExists();

    expect(mockBuild).toHaveBeenCalledWith({ kind: 30000, tags: [['d', 'communities']] });
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockEventStoreAdd).toHaveBeenCalledWith(SIGNED_FOLLOW_SET);
    expect(publishStarted).toBe(true);
    expect(mockPublishEvent).toHaveBeenCalledWith(SIGNED_FOLLOW_SET);
  });

  it('inserts the signed event into EventStore before kicking off the publish', async () => {
    // Order matters — actionRunnerOptimistic.run, called next by joinCommunity,
    // must be able to read the freshly-added follow set synchronously.
    mockGetReplaceable.mockReturnValue(undefined);
    /** @type {string[]} */
    const callOrder = [];
    mockEventStoreAdd.mockImplementation(() => callOrder.push('add'));
    mockPublishEvent.mockImplementation(() => {
      callOrder.push('publish');
      return new Promise(() => {});
    });

    await ensureFollowSetExists();

    expect(callOrder).toEqual(['add', 'publish']);
  });

  it('does NOT bootstrap when the network delivers an existing follow set', async () => {
    // Local store misses, but the loader finds the user's real follow set on a
    // relay. Creating an empty set here would wipe their memberships.
    mockGetReplaceable.mockReturnValue(undefined);
    mockAddressLoader.mockImplementation(() => hangingLoader());
    mockReplaceableSubscribe.mockImplementation((/** @type {any} */ cb) => {
      cb(undefined);
      // Event arrives from the network shortly after subscribing.
      setTimeout(
        () =>
          cb({
            ...SIGNED_FOLLOW_SET,
            tags: [
              ['d', 'communities'],
              ['p', 'x']
            ]
          }),
        0
      );
      return { unsubscribe: () => {} };
    });

    await ensureFollowSetExists();

    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(mockEventStoreAdd).not.toHaveBeenCalled();
  });

  it('queries the network on both lookup relays and the user NIP-65 write relays', async () => {
    mockGetReplaceable.mockReturnValue(undefined);

    await ensureFollowSetExists();

    expect(mockAddressLoader).toHaveBeenCalledWith({
      kind: 30000,
      pubkey: TEST_PUBKEY,
      identifier: 'communities',
      relays: ['wss://lookup.example', 'wss://write.example']
    });
  });

  it('bootstraps after the timeout when relays hang and no event arrives', async () => {
    vi.useFakeTimers();
    mockGetReplaceable.mockReturnValue(undefined);
    mockAddressLoader.mockImplementation(() => hangingLoader());

    const promise = ensureFollowSetExists();
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockEventStoreAdd).toHaveBeenCalledWith(SIGNED_FOLLOW_SET);
    expect(mockPublishEvent).toHaveBeenCalledWith(SIGNED_FOLLOW_SET);
  });

  it('still confirms absence via lookup relays when getWriteRelays rejects', async () => {
    mockGetReplaceable.mockReturnValue(undefined);
    mockGetWriteRelays.mockRejectedValue(new Error('relay list fetch failed'));

    await ensureFollowSetExists();

    expect(mockAddressLoader).toHaveBeenCalledWith({
      kind: 30000,
      pubkey: TEST_PUBKEY,
      identifier: 'communities',
      relays: ['wss://lookup.example']
    });
    // Absence confirmed → bootstrap proceeds
    expect(mockSign).toHaveBeenCalledTimes(1);
  });

  it('does not propagate background publish failures', async () => {
    // Relay rejection must not crash the join flow — local state remains
    // optimistically followed and the user sees no error toast.
    mockGetReplaceable.mockReturnValue(undefined);
    mockPublishEvent.mockRejectedValue(new Error('all relays failed'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(ensureFollowSetExists()).resolves.toBeUndefined();

    // Let the unhandled rejection settle into our .catch handler.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
