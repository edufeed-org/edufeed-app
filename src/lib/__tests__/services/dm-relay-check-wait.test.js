/**
 * waitForDmRelayCheck — the DM-relay self-check verdict as a promise instead of
 * a snapshot.
 *
 * getDmRelayCheckStatus() answers "what do we know right now", which is the
 * right shape for a UI hint but the wrong one for a write path: a caller that
 * reads 'checking' has to either skip the backfill (leaving the user with no
 * DM inbox) or publish anyway (risking a replaceable event landing on top of a
 * kind 10050 we simply had not fetched yet). Neither is acceptable.
 *
 * Waiting is affordable precisely because the *sender's* own 10050 is only
 * where replies land — it never routes an outgoing wrap — so nothing has to
 * block on it. This is what lets ensureDmRelayList insist on proof.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, Subject } from 'rxjs';

const mockGetReplaceable = vi.hoisted(() => vi.fn(() => /** @type {any} */ (undefined)));
const mockReplaceable$ = vi.hoisted(() => /** @type {{ current: any }} */ ({ current: null }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getReplaceable: mockGetReplaceable,
    add: vi.fn(),
    model: vi.fn(() => of([])),
    replaceable: vi.fn(() => mockReplaceable$.current),
    timeline: vi.fn(() => of([]))
  },
  pool: {
    request: vi.fn(() => of()),
    group: vi.fn(() => ({ subscription: vi.fn(() => of()) })),
    relay: vi.fn(() => ({ challenge$: of(null), authenticated: false }))
  }
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: vi.fn(() => of())
}));

const mockWriteRelays = vi.hoisted(() => ({ current: /** @type {string[]} */ (['wss://mine']) }));
const mockLookupRelays = vi.hoisted(() => ({ current: /** @type {string[]} */ (['wss://index']) }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => mockLookupRelays.current,
  getWriteRelays: async () => mockWriteRelays.current,
  getReadRelays: async () => []
}));

vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: { fallbackRelays: [] } }));

vi.mock('applesauce-common/helpers/encrypted-content-cache', () => ({
  persistEncryptedContent: () => () => {}
}));
vi.mock('applesauce-common/models', () => ({
  GiftWrapsModel: 'GiftWrapsModel',
  WrappedMessagesGroups: 'WrappedMessagesGroups',
  WrappedMessagesModel: 'WrappedMessagesModel'
}));

const { initializeDMs, cleanup, getDmRelayCheckStatus, waitForDmRelayCheck } = await import(
  '$lib/services/dm-service.svelte.js'
);

const PUBKEY = 'a'.repeat(64);
const SIGNER = /** @type {any} */ ({ getPublicKey: async () => PUBKEY });

/** A kind 10050 carrying one relay — enough to satisfy the self-check. */
function dmRelayList() {
  return { kind: 10050, pubkey: PUBKEY, tags: [['relay', 'wss://theirs']] };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockGetReplaceable.mockReturnValue(undefined);
  mockReplaceable$.current = new Subject();
  mockWriteRelays.current = ['wss://mine'];
  mockLookupRelays.current = ['wss://index'];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('waitForDmRelayCheck', () => {
  it('waits out the settle window instead of reporting the interim "checking"', async () => {
    vi.useFakeTimers();
    initializeDMs(PUBKEY, SIGNER);

    // Let the write/read relay lookups resolve so the settle deadline is armed.
    await vi.advanceTimersByTimeAsync(0);
    expect(getDmRelayCheckStatus()).toBe('checking');

    const pending = waitForDmRelayCheck();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toBe('absent');
  });

  it('resolves "present" the moment a kind 10050 arrives, without waiting out the window', async () => {
    vi.useFakeTimers();
    initializeDMs(PUBKEY, SIGNER);
    await vi.advanceTimersByTimeAsync(0);

    const pending = waitForDmRelayCheck();
    mockGetReplaceable.mockReturnValue(dmRelayList());
    mockReplaceable$.current.next(dmRelayList());

    await expect(pending).resolves.toBe('present');
  });

  it('resolves immediately when the check has already settled', async () => {
    vi.useFakeTimers();
    initializeDMs(PUBKEY, SIGNER);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getDmRelayCheckStatus()).toBe('absent');

    // No timer advance: an already-settled verdict must not make a caller wait.
    await expect(waitForDmRelayCheck()).resolves.toBe('absent');
  });

  it('resolves "idle" when no session is active', async () => {
    await expect(waitForDmRelayCheck()).resolves.toBe('idle');
  });

  it('gives up with the interim verdict when the check never settles', async () => {
    // Neither write relays nor indexers to query, so dm-service deliberately
    // never arms the settle deadline — it cannot conclude absence. A caller
    // must not hang on that forever; it gets 'checking' and declines to write.
    vi.useFakeTimers();
    mockWriteRelays.current = [];
    mockLookupRelays.current = [];
    initializeDMs(PUBKEY, SIGNER);
    await vi.advanceTimersByTimeAsync(0);

    const pending = waitForDmRelayCheck({ timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toBe('checking');
  });

  it('releases waiters on logout rather than leaving them pending', async () => {
    vi.useFakeTimers();
    initializeDMs(PUBKEY, SIGNER);
    await vi.advanceTimersByTimeAsync(0);

    const pending = waitForDmRelayCheck();
    cleanup();

    await expect(pending).resolves.toBe('idle');
  });
});
