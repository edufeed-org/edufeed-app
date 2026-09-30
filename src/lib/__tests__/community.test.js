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
 *      (probeCommunitiesFollowSet) before bootstrapping — a kind 30000 with a
 *      newer created_at REPLACES the old list on every relay, so creating an
 *      empty set on a mere local-cache miss destroys the user's memberships
 *      (2026-07-16 incident). Silence is not absence either: when the probe
 *      can't tell ('unknown'), the helper throws and creates nothing
 *      (2026-09-30 incident). The probe's relay mechanics are covered in
 *      follow-set-probe.test.js.
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

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getReplaceable: (/** @type {any[]} */ ...args) => mockGetReplaceable(...args),
    add: (/** @type {any} */ event) => mockEventStoreAdd(event)
  }
}));

/** @type {import('vitest').Mock<(pubkey: string) => Promise<'found' | 'absent' | 'unknown'>>} */
const mockProbe = vi.fn();

vi.mock('$lib/helpers/follow-set-probe.js', () => ({
  probeCommunitiesFollowSet: (/** @type {string} */ pubkey) => mockProbe(pubkey)
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
const mockRun = vi.fn();

vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run: (/** @type {any[]} */ ...args) => mockRun(...args) }
}));

// Import AFTER mocks are wired up.
const m = await import('$lib/paraglide/messages');
const { ensureFollowSetExists, joinCommunity, leaveCommunity, FollowSetUnavailableError } =
  await import('../helpers/community.js');

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
  // Default: the network confirms the user has no follow set yet.
  mockProbe.mockResolvedValue('absent');
  mockRun.mockResolvedValue(undefined);
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

  it('back-dates the bootstrap so a same-second follow update wins the replaceable tie-break', async () => {
    // joinCommunity runs bootstrap + AddUserToFollowSet within the same
    // second. NIP-01 (and applesauce's EventStore) resolve equal-created_at
    // replaceables by LOWEST id — a coin flip that silently kept the empty
    // bootstrap over the actual follow half the time (journey-test bug #9:
    // "Community folgen" never flips in-session). Back-dating the bootstrap
    // by one second makes any subsequent update strictly newer.
    mockGetReplaceable.mockReturnValue(undefined);

    await ensureFollowSetExists();

    expect(mockSign).toHaveBeenCalledOnce();
    const template = mockSign.mock.calls[0][0];
    const now = Math.floor(Date.now() / 1000);
    expect(template.created_at).toBeLessThanOrEqual(now - 1);
    expect(template.created_at).toBeGreaterThan(now - 10);
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

  it('does NOT bootstrap when the network finds an existing follow set', async () => {
    // Local store misses, but the probe finds the user's real follow set on a
    // relay. Creating an empty set here would wipe their memberships.
    mockGetReplaceable.mockReturnValue(undefined);
    mockProbe.mockResolvedValue('found');

    await ensureFollowSetExists();

    expect(mockProbe).toHaveBeenCalledWith(TEST_PUBKEY);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(mockEventStoreAdd).not.toHaveBeenCalled();
  });

  it('throws and creates NOTHING when the network cannot confirm absence (2026-09-30 wipe)', async () => {
    // Relays silent or failing: the list may well exist. The old code
    // bootstrapped after a timeout, and the join that followed replaced a
    // whole membership list with a single entry.
    mockGetReplaceable.mockReturnValue(undefined);
    mockProbe.mockResolvedValue('unknown');

    await expect(ensureFollowSetExists()).rejects.toBeInstanceOf(FollowSetUnavailableError);

    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(mockEventStoreAdd).not.toHaveBeenCalled();
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

  it('does not bootstrap when the active account changed while the network check was pending', async () => {
    // The network confirmation can take seconds. If the user switches
    // accounts mid-flight, bootstrapping now would sign an empty follow set
    // for the NEW account, whose absence was never confirmed.
    mockGetReplaceable.mockReturnValue(undefined);
    mockProbe.mockImplementation(async () => {
      mockManager.active = {
        pubkey: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        signer: { signEvent: vi.fn() }
      };
      return 'absent';
    });

    await ensureFollowSetExists();

    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
    expect(mockEventStoreAdd).not.toHaveBeenCalled();
  });

  it('single-flights concurrent calls for the same pubkey', async () => {
    mockGetReplaceable.mockReturnValue(undefined);

    await Promise.all([ensureFollowSetExists(), ensureFollowSetExists()]);

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
  });
});

describe('joinCommunity / leaveCommunity when the follow set is unavailable', () => {
  beforeEach(() => {
    mockGetReplaceable.mockReturnValue(undefined);
    mockProbe.mockResolvedValue('unknown');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('join fails with a localized message and never runs the follow action', async () => {
    const result = await joinCommunity('c'.repeat(64));

    expect(result.success).toBe(false);
    expect(result.error).toBe(m.communities_list_unavailable());
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('leave fails the same way instead of publishing a list built from nothing', async () => {
    const result = await leaveCommunity('c'.repeat(64));

    expect(result.success).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('join still works once the list is confirmed absent (first-ever follow)', async () => {
    mockProbe.mockResolvedValue('absent');

    const result = await joinCommunity('c'.repeat(64));

    expect(result.success).toBe(true);
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});
