// @ts-nocheck
/**
 * saveRelayList must reach the EventStore, and must not tie (edufeed-app#64)
 *
 * Kind 10002 is a cacheable kind, and the IndexedDB cache is the FIRST step of
 * applesauce's address loading sequence — a cache hit ends it before any relay
 * is queried. `publishEvent` never touches the EventStore, and the cache is fed
 * only from `eventStore.insert$`, so a saved relay list that is not offered to
 * the store is never cached and the PREVIOUS list is read back instead.
 *
 * That is the worst site in #64 because it is the relay list itself: a stale
 * read there mis-routes every subsequent query, so the blast radius is not one
 * screen.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PK = 'a'.repeat(64);

const publishEvent = vi.fn(async () => ({ success: true, successCount: 1, relays: [] }));
const eventStoreAdd = vi.fn();
const getReplaceable = vi.fn(() => undefined);
const signEvent = vi.fn(async (template) => ({
  ...template,
  id: 'e'.repeat(64),
  sig: 'f'.repeat(128)
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (...args) => publishEvent(...args)
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  invalidateRelayListCache: vi.fn(),
  getRelayListLookupRelays: () => ['wss://lookup.example']
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: { active: { pubkey: 'a'.repeat(64), signer: { signEvent: (t) => signEvent(t) } } }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: (...args) => eventStoreAdd(...args),
    getReplaceable: (...args) => getReplaceable(...args)
  },
  pool: {}
}));

import { saveRelayList } from '$lib/services/relay-settings-service.js';

const RELAYS = [{ url: 'wss://relay.example', read: true, write: true }];

describe('saveRelayList EventStore write (#64)', () => {
  beforeEach(() => {
    publishEvent.mockClear();
    publishEvent.mockResolvedValue({ success: true, successCount: 1, relays: [] });
    eventStoreAdd.mockClear();
    signEvent.mockClear();
    getReplaceable.mockReset();
    getReplaceable.mockReturnValue(undefined);
  });

  it('adds the published relay list to the EventStore', async () => {
    const signed = await saveRelayList(RELAYS, PK);

    expect(eventStoreAdd).toHaveBeenCalledTimes(1);
    expect(eventStoreAdd).toHaveBeenCalledWith(signed);
    expect(signed.kind).toBe(10002);
    expect(signed.tags).toEqual([['r', 'wss://relay.example']]);
  });

  it('does NOT cache the relay list when no relay accepted the publish', async () => {
    publishEvent.mockResolvedValue({ success: false, successCount: 0, relays: [] });

    await expect(saveRelayList(RELAYS, PK)).rejects.toThrow(/Failed to publish/);
    expect(eventStoreAdd).not.toHaveBeenCalled();
  });

  it('stamps created_at strictly newer than the relay list it replaces', async () => {
    // Two saves inside one second is entirely reachable in the settings UI.
    // Without the guard the second one ties, and on a tie nostr-idb keeps the
    // OLD list — deterministically, not half the time.
    const future = Math.floor(Date.now() / 1000) + 3600;
    getReplaceable.mockReturnValue({ kind: 10002, pubkey: PK, created_at: future });

    const signed = await saveRelayList(RELAYS, PK);

    expect(getReplaceable).toHaveBeenCalledWith(10002, PK);
    expect(signed.created_at).toBe(future + 1);
  });
});
