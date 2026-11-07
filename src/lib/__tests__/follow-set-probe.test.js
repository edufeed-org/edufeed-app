/**
 * Unit tests for probeCommunitiesFollowSet in src/lib/helpers/follow-set-probe.js
 *
 * The probe answers ONE question before anything may create a user's kind
 * 30000 d="communities" list from scratch: does it exist anywhere?
 *
 *   'found'   — the event is in EventStore, IDB, or arrived from any relay
 *   'absent'  — EVERY required relay (the user's write relays + the app's
 *               communikey relays) answered EOSE without it
 *   'unknown' — anything less: a required relay stayed silent, errored, or
 *               sent CLOSED before the deadline
 *
 * Only 'absent' licenses a bootstrap. The 2026-09-30 incident: on a flaky
 * connection the old check timed out, treated silence as absence, and a join
 * replaced a real membership list with a one-entry one.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Subject } from 'rxjs';

const PUBKEY = '0000000000000000000000000000000000000000000000000000000000000001';

const mockGetReplaceable = vi.fn();
const mockEventStoreAdd = vi.fn();

/** @type {Map<string, Subject<any>>} */
const relays = new Map();
/** @type {Set<string>} */
const unsubscribed = new Set();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getReplaceable: (/** @type {any[]} */ ...args) => mockGetReplaceable(...args),
    add: (/** @type {any} */ event) => mockEventStoreAdd(event)
  },
  pool: {
    relay: (/** @type {string} */ url) => ({
      req: () => ({
        subscribe: (/** @type {any} */ observer) => {
          const subject = new Subject();
          relays.set(url.replace(/\/$/, ''), subject);
          const sub = subject.subscribe(observer);
          return {
            unsubscribe: () => {
              unsubscribed.add(url.replace(/\/$/, ''));
              sub.unsubscribe();
            }
          };
        }
      })
    })
  }
}));

const mockCacheRequest = vi.fn(async (/** @type {any} */ _filters) => /** @type {any[]} */ ([]));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  cacheRequest: (/** @type {any} */ filters) => mockCacheRequest(filters)
}));

/** @type {{ relayList: any, outcome: 'found' | 'absent' | 'unknown' }} */
let relayListResolution;
const mockFetchRelayListResolution = vi.fn(
  async (/** @type {string} */ _pk) => relayListResolution
);
const mockDefaultRelays = vi.fn(() => ['wss://default.example']);
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  fetchRelayListResolution: (/** @type {string} */ pk) => mockFetchRelayListResolution(pk),
  getDefaultRelays: () => mockDefaultRelays()
}));

const mockAppCommunikeyRelays = vi.fn(() => ['wss://app.example']);
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: () => mockAppCommunikeyRelays()
}));

const mockLookupRelays = vi.fn(() => ['wss://lookup.example']);
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => mockLookupRelays()
}));

const { probeCommunitiesFollowSet, refreshContactList } = await import(
  '../helpers/follow-set-probe.js'
);
const { EventStore } = await import('applesauce-core');
const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure');

const FOLLOW_SET = {
  id: 'x',
  kind: 30000,
  pubkey: PUBKEY,
  created_at: 1,
  tags: [
    ['d', 'communities'],
    ['p', 'aa']
  ],
  content: '',
  sig: 's'
};

/** Let the probe's awaits (cache, write relays) run and its REQs open. */
const flush = () => vi.advanceTimersByTimeAsync(0);

/** @param {string} url @param {any} msg */
const send = (url, msg) => relays.get(url)?.next({ from: url, id: 'sub', ...msg });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  relays.clear();
  unsubscribed.clear();
  mockGetReplaceable.mockReturnValue(undefined);
  mockCacheRequest.mockResolvedValue([]);
  relayListResolution = {
    relayList: { writeRelays: ['wss://write.example'], readRelays: [] },
    outcome: 'found'
  };
  mockDefaultRelays.mockReturnValue(['wss://default.example']);
  mockAppCommunikeyRelays.mockReturnValue(['wss://app.example']);
  mockLookupRelays.mockReturnValue(['wss://lookup.example']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('probeCommunitiesFollowSet', () => {
  it("is 'found' without touching the network when the set is already in EventStore", async () => {
    mockGetReplaceable.mockReturnValue(FOLLOW_SET);

    await expect(probeCommunitiesFollowSet(PUBKEY)).resolves.toBe('found');
    expect(relays.size).toBe(0);
  });

  it("is 'found' from the IDB cache and feeds the cached event into EventStore", async () => {
    mockCacheRequest.mockResolvedValue([FOLLOW_SET]);

    await expect(probeCommunitiesFollowSet(PUBKEY)).resolves.toBe('found');
    expect(mockEventStoreAdd).toHaveBeenCalledWith(FOLLOW_SET);
    expect(relays.size).toBe(0);
  });

  it('asks write relays, app communikey relays and lookup relays, once each', async () => {
    mockLookupRelays.mockReturnValue(['wss://lookup.example', 'wss://write.example']);

    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    expect([...relays.keys()].sort()).toEqual([
      'wss://app.example',
      'wss://lookup.example',
      'wss://write.example'
    ]);
    for (const url of relays.keys()) send(url, { type: 'EOSE' });
    await promise;
  });

  it("is 'found' as soon as ANY relay (even a best-effort lookup one) delivers the event", async () => {
    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    send('wss://lookup.example', { type: 'EVENT', event: FOLLOW_SET });

    await expect(promise).resolves.toBe('found');
    expect(mockEventStoreAdd).toHaveBeenCalledWith(FOLLOW_SET);
    // Settling tears every REQ down.
    await flush();
    expect(unsubscribed).toEqual(new Set(relays.keys()));
  });

  it("is 'absent' once every relay has answered EOSE without the event", async () => {
    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    for (const url of relays.keys()) send(url, { type: 'EOSE' });

    await expect(promise).resolves.toBe('absent');
  });

  it("is 'absent' at the deadline when write + app relays answered and only a lookup relay hangs", async () => {
    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    send('wss://write.example', { type: 'EOSE' });
    send('wss://app.example', { type: 'EOSE' });
    // wss://lookup.example never answers.

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBe('absent');
  });

  it("is 'unknown' — never 'absent' — when a required relay stays silent (the 2026-09-30 wipe)", async () => {
    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    send('wss://write.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });
    // wss://app.example — the relay that actually holds the list — is silent.

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBe('unknown');
  });

  it("is 'unknown' when a required relay errors or sends CLOSED", async () => {
    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    relays.get('wss://write.example')?.error(new Error('connection refused'));
    send('wss://app.example', { type: 'CLOSED', reason: 'auth-required: sign in' });
    send('wss://lookup.example', { type: 'EOSE' });

    // Every relay is done — no need to wait for the deadline.
    await expect(promise).resolves.toBe('unknown');
  });

  it("is 'unknown' when fully offline (every relay errors)", async () => {
    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    for (const subject of relays.values()) subject.error(new Error('offline'));

    await expect(promise).resolves.toBe('unknown');
  });

  it("is 'unknown' when a WRITE relay is silent even though every app relay answered", async () => {
    // The incident shape: the list lives on the user's outbox relay, which
    // stopped answering while other relays said "not here".
    mockAppCommunikeyRelays.mockReturnValue(['wss://app.example', 'wss://app2.example']);

    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    send('wss://app.example', { type: 'EOSE' });
    send('wss://app2.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBe('unknown');
  });

  it("is 'absent' when one app relay is dead but another answered (a dead app relay must not block every first follow)", async () => {
    // Observed 2026-09-30: dev.relay.edufeed.org stopped resolving while
    // listed in COMMUNIKEY_RELAYS.
    mockAppCommunikeyRelays.mockReturnValue(['wss://app.example', 'wss://dead.example']);

    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    relays.get('wss://dead.example')?.error(new Error('getaddrinfo ENOTFOUND'));
    send('wss://app.example', { type: 'EOSE' });
    send('wss://write.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });

    await expect(promise).resolves.toBe('absent');
  });

  it("is 'unknown' without asking anyone when the user's relay list could not be fetched", async () => {
    // We don't even know where their follow set would live.
    relayListResolution = { relayList: null, outcome: 'unknown' };

    await expect(probeCommunitiesFollowSet(PUBKEY)).resolves.toBe('unknown');
    expect(relays.size).toBe(0);
  });

  it('uses the default relays as write relays for a user confirmed to have no relay list', async () => {
    relayListResolution = { relayList: null, outcome: 'absent' };

    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    expect([...relays.keys()].sort()).toEqual([
      'wss://app.example',
      'wss://default.example',
      'wss://lookup.example'
    ]);
    send('wss://app.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });
    // The default (= write) relay is silent.
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBe('unknown');
  });

  it("is 'absent' when one write relay is unreachable but another answered (dead relays in a 10002 are common)", async () => {
    relayListResolution = {
      relayList: {
        writeRelays: ['wss://write.example', 'wss://dead-write.example'],
        readRelays: []
      },
      outcome: 'found'
    };

    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    relays.get('wss://dead-write.example')?.error(new Error('connection refused'));
    send('wss://write.example', { type: 'EOSE' });
    send('wss://app.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });

    await expect(promise).resolves.toBe('absent');
  });

  it("is 'unknown' when every write relay is unreachable", async () => {
    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    relays.get('wss://write.example')?.error(new Error('connection refused'));
    send('wss://app.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });

    await expect(promise).resolves.toBe('unknown');
  });

  it("is 'unknown' when a write relay answers CLOSED (it may hold the list but refuses to say)", async () => {
    const promise = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    send('wss://write.example', { type: 'CLOSED', reason: 'auth-required: sign in' });
    send('wss://app.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });

    await expect(promise).resolves.toBe('unknown');
  });

  it('shares one in-flight probe per pubkey', async () => {
    const a = probeCommunitiesFollowSet(PUBKEY);
    const b = probeCommunitiesFollowSet(PUBKEY);
    await flush();

    expect(mockCacheRequest).toHaveBeenCalledTimes(1);
    for (const url of relays.keys()) send(url, { type: 'EOSE' });
    await expect(Promise.all([a, b])).resolves.toEqual(['absent', 'absent']);

    // Once settled, a new call probes afresh.
    const c = probeCommunitiesFollowSet(PUBKEY);
    await flush();
    expect(mockCacheRequest).toHaveBeenCalledTimes(2);
    for (const url of relays.keys()) send(url, { type: 'EOSE' });
    await c;
  });
});

describe('refreshContactList', () => {
  const sk = generateSecretKey();
  const me = getPublicKey(sk);
  /** @param {number} created_at @param {string[]} follows */
  const signed = (created_at, follows) =>
    finalizeEvent({ kind: 3, created_at, tags: follows.map((p) => ['p', p]), content: '' }, sk);
  /** @param {string} n distinct pubkey per test (the freshness memo is module-wide) */
  const other = (n) => PUBKEY.replace(/1$/, n);

  it('asks write + lookup relays and lets a newer network list replace a stale cached one', async () => {
    const store = new EventStore();
    mockEventStoreAdd.mockImplementation((event) => store.add(event));
    store.add(signed(1, ['a'.repeat(64)]));

    const promise = refreshContactList(me);
    await flush();
    expect([...relays.keys()].sort()).toEqual(['wss://lookup.example', 'wss://write.example']);

    send('wss://write.example', {
      type: 'EVENT',
      event: signed(2, ['a'.repeat(64), 'b'.repeat(64)])
    });
    send('wss://write.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });

    await expect(promise).resolves.toBe(true);
    expect(store.getReplaceable(3, me)?.created_at).toBe(2);
  });

  it('passes on an empty EOSE from every write relay and keeps the cached list (no lockout)', async () => {
    const sk2 = generateSecretKey();
    const pk = getPublicKey(sk2);
    const cached = finalizeEvent(
      { kind: 3, created_at: 1, tags: [['p', 'a'.repeat(64)]], content: '' },
      sk2
    );
    const store = new EventStore();
    mockEventStoreAdd.mockImplementation((event) => store.add(event));
    store.add(cached);

    const promise = refreshContactList(pk);
    await flush();
    send('wss://write.example', { type: 'EOSE' });
    send('wss://lookup.example', { type: 'EOSE' });

    await expect(promise).resolves.toBe(true);
    expect(store.getReplaceable(3, pk)).toBe(cached);
  });

  it('is false when write relays stay silent, even if a lookup relay delivered the list', async () => {
    const pk = other('2');
    const promise = refreshContactList(pk);
    await flush();
    send('wss://lookup.example', { type: 'EVENT', event: { ...FOLLOW_SET, kind: 3, pubkey: pk } });
    send('wss://lookup.example', { type: 'EOSE' });
    // wss://write.example stays silent: the deadline ends the refresh.
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(promise).resolves.toBe(false);
    await flush();
    expect(unsubscribed).toEqual(new Set(relays.keys()));
  });

  it('is false when every write relay errors or sends CLOSED', async () => {
    relayListResolution = {
      relayList: { writeRelays: ['wss://write.example', 'wss://write2.example'], readRelays: [] },
      outcome: 'found'
    };
    const promise = refreshContactList(other('6'));
    await flush();
    relays.get('wss://write.example')?.error(new Error('connection refused'));
    send('wss://write2.example', { type: 'CLOSED', reason: 'auth-required: sign in' });
    send('wss://lookup.example', { type: 'EOSE' });
    await expect(promise).resolves.toBe(false);
  });

  it('is false without asking anyone when the relay list could not be fetched', async () => {
    relayListResolution = { relayList: null, outcome: 'unknown' };
    await expect(refreshContactList(other('3'))).resolves.toBe(false);
    expect(relays.size).toBe(0);
  });

  it('sends no further request while a confirmation is fresh', async () => {
    const pk = other('4');
    const first = refreshContactList(pk);
    await flush();
    for (const url of relays.keys()) send(url, { type: 'EOSE' });
    await expect(first).resolves.toBe(true);

    relays.clear();
    await expect(refreshContactList(pk)).resolves.toBe(true);
    expect(relays.size).toBe(0);
    expect(mockFetchRelayListResolution).toHaveBeenCalledTimes(1);
  });
});
