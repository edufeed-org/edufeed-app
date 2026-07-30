// @ts-nocheck
/**
 * A failed optimistic publish must restore what it replaced (edufeed-app#64)
 *
 * Removing the phantom is not enough on its own. Adding a replacement evicts
 * its predecessor from the EventStore (keepOldVersions is off) and, once the
 * cache batch flushes, overwrites it in IDB too — nostr-idb keys replaceable
 * events by `kind:pubkey:d`. So deleting the phantom leaves the address
 * EMPTY, not restored.
 *
 * Empty is not stuck — a cache miss falls through to the relays — but the
 * publish failing is precisely the case where the relays are not answering,
 * so the user would watch their content vanish rather than revert to the
 * version that is actually still out there.
 *
 * TestOER raised this on PR #69 before it merged, and it was measured against
 * IndexedDB directly: late failure -> phantom in IDB -> uncache -> EMPTY.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const relayMocks = new Map();
/** Order of cache/store operations on the failure path. */
let calls = [];
let replaceable = undefined;

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  pool: { relay: (url) => relayMocks.get(url) },
  eventStore: {
    add: vi.fn((e) => calls.push(`add:${e.id.slice(0, 4)}`)),
    remove: vi.fn((e) => calls.push(`remove:${e.id.slice(0, 4)}`)),
    getReplaceable: vi.fn(() => {
      calls.push('getReplaceable');
      return replaceable;
    })
  }
}));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  uncacheEvent: vi.fn(async (e) => {
    calls.push(`uncache:${e.id.slice(0, 4)}`);
  }),
  recacheEvent: vi.fn(async (e) => {
    calls.push(`recache:${e.id.slice(0, 4)}`);
  })
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPublishRelays: vi.fn(async () => ['wss://dead.example']),
  getPrimaryWriteRelay: vi.fn(() => 'wss://dead.example')
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => []),
  kindToAppRelayCategory: vi.fn(() => null)
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getRelaysForKind: vi.fn(() => []),
  getCommunityGlobalRelays: vi.fn(() => []),
  getCommunityRelaysByEnforcement: vi.fn(() => ({ enforced: [], optional: [] }))
}));

import { publishEventOptimistic } from '$lib/services/publish-service.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte.js';
import { uncacheEvent, recacheEvent } from '$lib/stores/event-cache.svelte.js';

const PK = 'a'.repeat(64);

/** An addressable resource (kind 30142) — the shape the bug bites hardest. */
const PREVIOUS = {
  id: '1'.repeat(64),
  kind: 30142,
  pubkey: PK,
  created_at: 1000,
  tags: [['d', 'res-1']],
  content: '',
  sig: 'f'.repeat(128)
};
const PHANTOM = { ...PREVIOUS, id: '2'.repeat(64), created_at: 1001 };

/** Every relay rejects, which is what drives the failure path. */
function allRelaysReject() {
  relayMocks.set('wss://dead.example', {
    publish: vi.fn(async () => ({ ok: false, message: 'blocked', from: 'wss://dead.example' }))
  });
}

async function runToFailure(event) {
  let finalStatus = null;
  publishEventOptimistic(event, [], { onStatusChange: (s) => (finalStatus = s) });
  await vi.waitFor(() => expect(finalStatus?.status).toBe('failed'));
  // The restore happens after an awaited uncacheEvent, one tick past 'failed'.
  await vi.waitFor(() => expect(calls.some((c) => c.startsWith('uncache:'))).toBe(true));
  return finalStatus;
}

describe('failed optimistic publish restores the replaced version (#64)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    relayMocks.clear();
    calls = [];
    replaceable = undefined;
  });

  it('puts the previous version back after removing the phantom', async () => {
    replaceable = PREVIOUS;
    allRelaysReject();

    await runToFailure(PHANTOM);

    await vi.waitFor(() => {
      expect(calls).toContain(`add:${PREVIOUS.id.slice(0, 4)}`);
    });
    expect(eventStore.remove).toHaveBeenCalledWith(PHANTOM);
    expect(uncacheEvent).toHaveBeenCalledWith(PHANTOM);
  });

  it('restores AFTER the phantom is un-cached, never before', async () => {
    // Ordering is load-bearing: nostr-idb only writes a replaceable event when
    // it is newer than the entry at its address, and the phantom is newer than
    // what it replaced. Restoring first is silently rejected.
    replaceable = PREVIOUS;
    allRelaysReject();

    await runToFailure(PHANTOM);
    await vi.waitFor(() => expect(calls).toContain(`add:${PREVIOUS.id.slice(0, 4)}`));

    const uncacheAt = calls.indexOf(`uncache:${PHANTOM.id.slice(0, 4)}`);
    const restoreAt = calls.lastIndexOf(`add:${PREVIOUS.id.slice(0, 4)}`);
    expect(uncacheAt).toBeGreaterThan(-1);
    expect(restoreAt).toBeGreaterThan(uncacheAt);
  });

  it('captures the previous version BEFORE the optimistic add', async () => {
    // It is only reachable at that moment — the add evicts it.
    replaceable = PREVIOUS;
    allRelaysReject();

    await runToFailure(PHANTOM);

    expect(calls.indexOf('getReplaceable')).toBeLessThan(
      calls.indexOf(`add:${PHANTOM.id.slice(0, 4)}`)
    );
  });

  it('restores nothing when the event replaced nothing (a create)', async () => {
    replaceable = undefined;
    allRelaysReject();

    await runToFailure(PHANTOM);

    // Only the optimistic add, never a second one.
    expect(calls.filter((c) => c.startsWith('add:'))).toEqual([`add:${PHANTOM.id.slice(0, 4)}`]);
  });

  it('does not consult the store for a regular (non-replaceable) kind', async () => {
    replaceable = PREVIOUS;
    allRelaysReject();

    await runToFailure({ ...PHANTOM, kind: 1, tags: [] });

    expect(eventStore.getReplaceable).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.startsWith('add:'))).toHaveLength(1);
  });

  it('writes the restored version to IDB directly, not only to the EventStore', async () => {
    // eventStore.add alone is not enough: applesauce's persistEventsToCache
    // filters on !isFromCache, and a predecessor loaded through cacheRequest
    // carries Symbol.for('from-cache'). So on any normal page load the memory
    // restore lands and the durable one silently does not — which is the 404
    // this whole path exists to prevent. Measured on dev by TestOER.
    replaceable = PREVIOUS;
    allRelaysReject();

    await runToFailure(PHANTOM);

    await vi.waitFor(() => expect(recacheEvent).toHaveBeenCalledWith(PREVIOUS));
    expect(calls).toContain(`add:${PREVIOUS.id.slice(0, 4)}`);
  });

  it('recaches AFTER the phantom is un-cached', async () => {
    // Same ordering constraint as the memory restore: nostr-idb only writes a
    // replaceable event when it is newer than the entry at its address.
    replaceable = PREVIOUS;
    allRelaysReject();

    await runToFailure(PHANTOM);
    await vi.waitFor(() => expect(calls).toContain(`recache:${PREVIOUS.id.slice(0, 4)}`));

    const uncacheAt = calls.indexOf(`uncache:${PHANTOM.id.slice(0, 4)}`);
    const recacheAt = calls.indexOf(`recache:${PREVIOUS.id.slice(0, 4)}`);
    expect(uncacheAt).toBeGreaterThan(-1);
    expect(recacheAt).toBeGreaterThan(uncacheAt);
  });

  it('does not recache when there was nothing to replace', async () => {
    replaceable = undefined;
    allRelaysReject();

    await runToFailure(PHANTOM);

    expect(recacheEvent).not.toHaveBeenCalled();
  });

  it('does not re-add when the store returns the same event', async () => {
    // Defensive: a store that hands back the event we just added must not
    // cause it to be resurrected right after we removed it.
    replaceable = PHANTOM;
    allRelaysReject();

    await runToFailure(PHANTOM);

    expect(calls.filter((c) => c === `add:${PHANTOM.id.slice(0, 4)}`)).toHaveLength(1);
  });
});
