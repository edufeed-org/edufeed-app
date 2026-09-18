// @ts-nocheck
/**
 * Healing profiles that are already stranded.
 *
 * Fixing the publish path only helps the NEXT save. Accounts whose kind 0
 * currently lives on a single relay (because some client narrowed their kind
 * 10002) stay invisible to the rest of the network until they happen to edit
 * their profile again. So once per session we re-publish the two identity
 * events we already hold — they are signed and immutable, so this is a pure
 * distribution fix, no new event, no signer round-trip (works for npub-login
 * accounts too).
 *
 * Amethyst does the same thing on a narrower trigger: `republishEventsTo(...)`
 * pushes the account's metadata to the new outbox whenever the relay list
 * changes.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BehaviorSubject } from 'rxjs';

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: { getReplaceable: vi.fn(), replaceable: vi.fn() }
}));
vi.mock('$lib/services/publish-service.js', () => ({
  publishToRelays: vi.fn(async () => ({ success: true, successCount: 1 }))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getIdentityBroadcastRelays: vi.fn(() => ['wss://purplepag.es'])
}));

const { rebroadcastIdentityEvents, scheduleIdentityRebroadcast, resetIdentityRebroadcastState } =
  await import('$lib/services/identity-rebroadcast.js');

const PUBKEY = 'a'.repeat(64);
const RELAYS = ['wss://purplepag.es', 'wss://relay.damus.io'];

/** @param {number} kind */
const ev = (kind) => ({ id: String(kind).padStart(64, '0'), kind, pubkey: PUBKEY, tags: [] });

/** @param {Record<number, any>} byKind */
function stubStore(byKind) {
  return {
    getReplaceable: (kind, pubkey) => (pubkey === PUBKEY ? byKind[kind] : undefined),
    replaceable: (kind, pubkey) =>
      new BehaviorSubject(pubkey === PUBKEY ? (byKind[kind] ?? undefined) : undefined)
  };
}

describe('rebroadcastIdentityEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIdentityRebroadcastState();
  });

  it('republishes the account kind 0 and kind 10002 to the identity relays', async () => {
    const publish = vi.fn(async () => ({ success: true, successCount: 2 }));
    const result = await rebroadcastIdentityEvents(PUBKEY, {
      store: stubStore({ 0: ev(0), 10002: ev(10002) }),
      relays: RELAYS,
      publish
    });

    expect(result.kinds).toEqual([0, 10002]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0].kind).toBe(0);
    expect(publish.mock.calls[0][1]).toEqual(RELAYS);
    expect(publish.mock.calls[1][0].kind).toBe(10002);
  });

  it('skips kinds the store does not have yet', async () => {
    const publish = vi.fn(async () => ({ success: true, successCount: 1 }));
    const result = await rebroadcastIdentityEvents(PUBKEY, {
      store: stubStore({ 10002: ev(10002) }),
      relays: RELAYS,
      publish
    });

    expect(result.kinds).toEqual([10002]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('runs once per pubkey per session', async () => {
    const publish = vi.fn(async () => ({ success: true, successCount: 1 }));
    const store = stubStore({ 0: ev(0) });

    await rebroadcastIdentityEvents(PUBKEY, { store, relays: RELAYS, publish });
    const second = await rebroadcastIdentityEvents(PUBKEY, { store, relays: RELAYS, publish });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(second.kinds).toEqual([]);
    expect(second.skipped).toBe('already-done');
  });

  it('does nothing without a pubkey or without relays', async () => {
    const publish = vi.fn();
    expect((await rebroadcastIdentityEvents('', { relays: RELAYS, publish })).kinds).toEqual([]);
    expect(
      (
        await rebroadcastIdentityEvents(PUBKEY, {
          store: stubStore({ 0: ev(0) }),
          relays: [],
          publish
        })
      ).kinds
    ).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not reject when a relay publish throws', async () => {
    const publish = vi.fn(async () => {
      throw new Error('relay down');
    });
    await expect(
      rebroadcastIdentityEvents(PUBKEY, { store: stubStore({ 0: ev(0) }), relays: RELAYS, publish })
    ).resolves.toMatchObject({ kinds: [] });
  });
});

describe('scheduleIdentityRebroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIdentityRebroadcastState();
  });

  it('waits for the account kind 0 to arrive before republishing', async () => {
    const publish = vi.fn(async () => ({ success: true, successCount: 1 }));
    const profile$ = new BehaviorSubject(undefined);
    const store = {
      getReplaceable: (kind) => (kind === 0 ? profile$.value : ev(10002)),
      replaceable: (kind) => (kind === 0 ? profile$ : new BehaviorSubject(ev(kind)))
    };

    scheduleIdentityRebroadcast(PUBKEY, { store, relays: RELAYS, publish, timeoutMs: 0 });
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();

    profile$.next(ev(0));
    await vi.waitFor(() => expect(publish).toHaveBeenCalled());
    expect(publish.mock.calls.map((c) => c[0].kind)).toEqual([0, 10002]);
  });

  it('returns a teardown that stops a pending rebroadcast', async () => {
    const publish = vi.fn(async () => ({ success: true, successCount: 1 }));
    const profile$ = new BehaviorSubject(undefined);
    const store = {
      getReplaceable: () => undefined,
      replaceable: () => profile$
    };

    const stop = scheduleIdentityRebroadcast(PUBKEY, {
      store,
      relays: RELAYS,
      publish,
      timeoutMs: 0
    });
    stop();
    profile$.next(ev(0));
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });
});
