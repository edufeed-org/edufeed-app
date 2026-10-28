// @ts-nocheck
/** @vitest-environment node */
/**
 * Channel mentions reach the inbox (issue 50fc19f1). Kind-9 NIP-29 channel
 * messages live on the groups relay only, which the inbox never asked — it
 * requested kind 9 `#p` from the app relays, where no channel message is.
 * The groups-relay leg now carries that filter beside the kind-9000 "added
 * you" one, history and live; and because pyramid silently omits closed
 * channels from an anonymous REQ (no auth-required CLOSE, see GroupChat), the
 * inbox authenticates once with the active signer and reads again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const noopSub = { unsubscribe: vi.fn() };
const noopObservable = { subscribe: vi.fn(() => noopSub) };

const liveSubscription = vi.hoisted(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }));
const group = vi.hoisted(() => ({ subscription: vi.fn(() => liveSubscription) }));
const relayObject = vi.hoisted(() => ({ url: 'wss://groups.example/' }));
const pool = vi.hoisted(() => ({ group: vi.fn(() => group), relay: vi.fn(() => relayObject) }));
const eventStore = vi.hoisted(() => ({ add: vi.fn(), model: vi.fn(), replaceable: vi.fn() }));
const fetchEvents = vi.hoisted(() =>
  vi.fn(() => ({ subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) }))
);
const authenticateOnce = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const manager = vi.hoisted(() => ({ active: /** @type {any} */ ({ signer: { sign: () => {} } }) }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore, pool }));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  fetchEvents,
  addressLoader: vi.fn(() => noopObservable),
  eventLoader: vi.fn(() => noopObservable)
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: () => ['wss://relay1'],
  getCalendarRelays: () => [],
  getEducationalRelays: () => [],
  getNotificationFallbackRelays: () => [],
  getAllLookupRelays: () => ['wss://lookup1'],
  getEventLoaderLookupRelays: () => [],
  getGroupsRelays: () => ['wss://groups.example']
}));
vi.mock('$lib/groups/relay-auth.js', () => ({ authenticateOnce }));
vi.mock('applesauce-core/models', () => ({ TimelineModel: 'TimelineModel' }));
vi.mock('$lib/helpers/event-factory.js', () => ({
  finalizeDraft: vi.fn(async (draft) => await draft)
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: vi.fn() }));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  getReadRelays: vi.fn(async () => []),
  getWriteRelays: vi.fn(async () => [])
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
    setItem: vi.fn((key, value) => void (store[key] = String(value))),
    removeItem: vi.fn((key) => void delete store[key]),
    clear: () => void (store = {})
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const PUBKEY = 'a'.repeat(64);
const GROUPS = ['wss://groups.example'];
const flush = () => new Promise((r) => setTimeout(r, 0));

/** fetchEvents calls aimed at the groups relay → their filter lists */
const groupsFetches = () =>
  fetchEvents.mock.calls.filter(([relays]) => relays[0] === GROUPS[0]).map(([, f]) => f);
/** live legs opened on the groups relay → their filter lists */
const groupsLive = () => {
  const out = [];
  pool.group.mock.calls.forEach(([relays], i) => {
    if (relays[0] === GROUPS[0]) out.push(group.subscription.mock.calls[i][0]);
  });
  return out;
};

describe('inbox: channel mentions from the groups relay', () => {
  let mod;
  beforeEach(async () => {
    vi.clearAllMocks();
    manager.active = { signer: { sign: () => {} } };
    eventStore.model.mockReturnValue(noopObservable);
    eventStore.replaceable.mockReturnValue(noopObservable);
    mod = await import('$lib/services/inbox-service.svelte.js');
  });
  afterEach(() => mod.cleanup());

  it('asks the groups relay for kind-9 messages that p-tag the user, history and live', () => {
    mod.initializeInbox(PUBKEY);
    const [history] = groupsFetches();
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kinds: [9000], '#p': [PUBKEY], limit: 50 }),
        expect.objectContaining({ kinds: [9], '#p': [PUBKEY], limit: 50 })
      ])
    );
    const [live] = groupsLive();
    expect(live).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kinds: [9], '#p': [PUBKEY] }),
        expect.objectContaining({ kinds: [9000], '#p': [PUBKEY] })
      ])
    );
    expect(live.find((f) => f.kinds[0] === 9).since).toBeGreaterThan(history[0].since);
  });

  it('authenticates once with the active signer and reads again, so closed channels answer too', async () => {
    mod.initializeInbox(PUBKEY);
    expect(groupsFetches()).toHaveLength(1);
    expect(pool.relay).toHaveBeenCalledWith(GROUPS[0]);
    expect(authenticateOnce).toHaveBeenCalledWith(relayObject, manager.active.signer);
    await flush();
    expect(groupsFetches()).toHaveLength(2);
    expect(groupsLive()).toHaveLength(2);
  });

  it('does not re-read after a refused or missing authentication', async () => {
    authenticateOnce.mockResolvedValueOnce({ ok: false, message: 'no challenge' });
    mod.initializeInbox(PUBKEY);
    await flush();
    expect(groupsFetches()).toHaveLength(1);
    expect(groupsLive()).toHaveLength(1);
  });

  it('reads anonymously when there is no signer', async () => {
    manager.active = null;
    mod.initializeInbox(PUBKEY);
    await flush();
    expect(authenticateOnce).not.toHaveBeenCalled();
    expect(groupsFetches()).toHaveLength(1);
  });

  it('exposes the inbox pubkey for viewer-dependent row copy', () => {
    expect(mod.getInboxPubkey()).toBeNull();
    mod.initializeInbox(PUBKEY);
    expect(mod.getInboxPubkey()).toBe(PUBKEY);
    mod.cleanup();
    expect(mod.getInboxPubkey()).toBeNull();
  });
});
