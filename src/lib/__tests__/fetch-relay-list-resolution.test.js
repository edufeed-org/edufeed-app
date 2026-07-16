/**
 * fetchRelayList resolution semantics.
 *
 * The old implementation raced a fixed 3s timeout against the kind 10002
 * arriving; a slow lookup on a fresh session made getWriteRelays silently
 * fall back to public fallbackRelays, misrouting the user's publishes
 * (2026-07-16 incident). New contract:
 *   1. Model emission (event found)   → resolve the parsed list immediately.
 *   2. Loader completion, no event    → resolve null fast (confirmed absence,
 *      the legit new-user case) without burning the full timeout.
 *   3. Neither within the hard cap    → resolve null AND console.warn, so
 *      misrouted publishes are diagnosable.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockModelSubscribe = vi.fn();

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: {
    model: () => ({ subscribe: (/** @type {any} */ cb) => mockModelSubscribe(cb) })
  },
  pool: {}
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    relayListLookupRelays: ['wss://lookup.example'],
    fallbackRelays: ['wss://fallback.example']
  }
}));

vi.mock('$lib/models/relay-list-model.js', () => ({ RelayListModel: vi.fn() }));

const mockLoaderSubscribe = vi.fn();

vi.mock('$lib/loaders/relay-list-loader.js', () => ({
  createRelayListLoader: () => () => () => ({
    subscribe: (/** @type {any} */ observer) => mockLoaderSubscribe(observer)
  })
}));

const { fetchRelayList, clearRelayListCache } = await import('../services/relay-service.svelte.js');

const PUBKEY_A = 'a'.repeat(64);
const PUBKEY_B = 'b'.repeat(64);
const PUBKEY_C = 'c'.repeat(64);
const RELAY_LIST = {
  writeRelays: ['wss://write.example'],
  readRelays: ['wss://read.example']
};

beforeEach(() => {
  vi.clearAllMocks();
  clearRelayListCache();
  // Defaults: model emits "nothing", loader never completes.
  mockModelSubscribe.mockImplementation((cb) => {
    cb(undefined);
    return { unsubscribe: () => {} };
  });
  mockLoaderSubscribe.mockImplementation(() => ({ unsubscribe: () => {} }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchRelayList', () => {
  it('resolves the parsed list when the model emits (event in store)', async () => {
    mockModelSubscribe.mockImplementation((cb) => {
      cb(RELAY_LIST);
      return { unsubscribe: () => {} };
    });

    const result = await fetchRelayList(PUBKEY_A);

    expect(result?.writeRelays).toEqual(['wss://write.example']);
    expect(result?.readRelays).toEqual(['wss://read.example']);
  });

  it('resolves null promptly on loader completion when no event was found', async () => {
    vi.useFakeTimers();
    mockLoaderSubscribe.mockImplementation((observer) => {
      observer?.complete?.();
      return { unsubscribe: () => {} };
    });

    const result = await fetchRelayList(PUBKEY_B);

    // No timer advancing needed — completion alone resolved it.
    expect(result).toBeNull();
  });

  it('resolves null and warns after the hard cap when relays hang', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const promise = fetchRelayList(PUBKEY_C);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
