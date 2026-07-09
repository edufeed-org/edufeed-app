// @ts-nocheck
/**
 * publish-service OK-response tests (edufeed-app#4)
 *
 * applesauce's relay.publish() RESOLVES with `{ok:false, message}` when a
 * relay rejects an event — it does not throw. The publish services must not
 * count such rejections as successes: that overstates reach, makes the
 * "all relays failed → remove optimistic event" path unreachable, and leaves
 * phantom shares in the UI.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const relayMocks = new Map();

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  pool: { relay: (url) => relayMocks.get(url) },
  eventStore: { add: vi.fn(), remove: vi.fn() }
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPublishRelays: vi.fn(async () => ['wss://accepts.example', 'wss://rejects.example']),
  getPrimaryWriteRelay: vi.fn(() => 'wss://accepts.example')
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

import { publishEvent, publishEventOptimistic } from '$lib/services/publish-service.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte.js';

const EVENT = {
  id: '1'.repeat(64),
  kind: 16,
  pubkey: 'a'.repeat(64),
  tags: [],
  sig: '',
  content: ''
};

describe('publish services honor the relay OK response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    relayMocks.clear();
  });

  it('publishEvent does not count an ok:false rejection as success', async () => {
    relayMocks.set('wss://accepts.example', {
      publish: vi.fn(async () => ({ ok: true, from: 'wss://accepts.example' }))
    });
    relayMocks.set('wss://rejects.example', {
      publish: vi.fn(async () => ({
        ok: false,
        message: 'restricted: sign up to write to this relay',
        from: 'wss://rejects.example'
      }))
    });

    const result = await publishEvent(EVENT);

    expect(result.successCount).toBe(1);
    expect(result.success).toBe(true);
  });

  it('publishEvent fails overall when every relay rejects', async () => {
    for (const url of ['wss://accepts.example', 'wss://rejects.example']) {
      relayMocks.set(url, {
        publish: vi.fn(async () => ({ ok: false, message: 'blocked', from: url }))
      });
    }

    const result = await publishEvent(EVENT);

    expect(result.successCount).toBe(0);
    expect(result.success).toBe(false);
  });

  it('publishEventOptimistic removes the optimistic event when every relay rejects', async () => {
    for (const url of ['wss://accepts.example', 'wss://rejects.example']) {
      relayMocks.set(url, {
        publish: vi.fn(async () => ({ ok: false, message: 'blocked', from: url }))
      });
    }

    let finalStatus = null;
    publishEventOptimistic(EVENT, [], { onStatusChange: (s) => (finalStatus = s) });

    await vi.waitFor(() => {
      expect(finalStatus?.status).toBe('failed');
    });
    expect(eventStore.remove).toHaveBeenCalledWith(EVENT);
  });

  it('publishEventOptimistic reports success when at least one relay accepts', async () => {
    relayMocks.set('wss://accepts.example', {
      publish: vi.fn(async () => ({ ok: true, from: 'wss://accepts.example' }))
    });
    relayMocks.set('wss://rejects.example', {
      publish: vi.fn(async () => ({ ok: false, message: 'blocked', from: 'wss://rejects.example' }))
    });

    let finalStatus = null;
    publishEventOptimistic(EVENT, [], { onStatusChange: (s) => (finalStatus = s) });

    await vi.waitFor(() => {
      expect(finalStatus?.status).toBe('success');
    });
    expect(finalStatus.successCount).toBe(1);
    expect(eventStore.remove).not.toHaveBeenCalled();
  });
});
