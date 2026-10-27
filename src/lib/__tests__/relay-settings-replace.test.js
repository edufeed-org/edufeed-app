// @ts-nocheck
/**
 * replaceDeadRelay — the Termi "one of your relays is dead" action. It edits
 * the user's LATEST kind 10002 (never a rebuilt one), keeps every tag it does
 * not understand, and publishes like saveRelayList: to the new list's write
 * relays and the lookup indexers on top of the outbox set, then feeds the
 * EventStore so the cache sees the new list (#64).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PK = 'a'.repeat(64);

const publishEvent = vi.fn(async () => ({ success: true, successCount: 1, relays: [] }));
const eventStoreAdd = vi.fn();
const getReplaceable = vi.fn(() => undefined);
const invalidateRelayListCache = vi.fn();
const signEvent = vi.fn(async (template) => ({
  ...template,
  id: 'e'.repeat(64),
  sig: 'f'.repeat(128)
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (...args) => publishEvent(...args)
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  invalidateRelayListCache: (...args) => invalidateRelayListCache(...args),
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

import { replaceDeadRelay } from '$lib/services/relay-settings-service.js';

const existing = {
  kind: 10002,
  pubkey: PK,
  id: 'c'.repeat(64),
  created_at: 1700000000,
  content: '',
  tags: [
    ['r', 'wss://relay.damus.io'],
    ['r', 'wss://nos.lol'],
    ['r', 'wss://relay.edufeed.org', 'write'],
    ['client', 'Ditto']
  ]
};

describe('replaceDeadRelay', () => {
  beforeEach(() => {
    publishEvent.mockClear();
    eventStoreAdd.mockClear();
    signEvent.mockClear();
    invalidateRelayListCache.mockClear();
    getReplaceable.mockReset();
    getReplaceable.mockReturnValue(existing);
  });

  it('signs an edit of the latest list with the dead relay swapped', async () => {
    const signed = await replaceDeadRelay('wss://nos.lol', 'wss://relay.primal.net', PK);
    expect(signed.kind).toBe(10002);
    expect(signed.tags).toEqual([
      ['r', 'wss://relay.damus.io'],
      ['r', 'wss://relay.primal.net'],
      ['r', 'wss://relay.edufeed.org', 'write'],
      ['client', 'Ditto']
    ]);
    expect(signed.created_at).toBeGreaterThan(existing.created_at);
    expect(signed.pubkey).toBe(PK);
  });

  it('publishes to the new write relays + lookup relays and feeds the EventStore', async () => {
    const signed = await replaceDeadRelay('wss://nos.lol', 'wss://relay.primal.net', PK);
    const [, , opts] = publishEvent.mock.calls[0];
    expect(opts.additionalRelays).toEqual(
      expect.arrayContaining([
        'wss://relay.damus.io',
        'wss://relay.primal.net',
        'wss://relay.edufeed.org',
        'wss://lookup.example'
      ])
    );
    expect(opts.additionalRelays).not.toContain('wss://nos.lol');
    expect(invalidateRelayListCache).toHaveBeenCalledWith(PK);
    expect(eventStoreAdd).toHaveBeenCalledWith(signed);
  });

  it('removes the relay when no replacement is given', async () => {
    const signed = await replaceDeadRelay('wss://nos.lol', null, PK);
    expect(signed.tags.map((t) => t[1])).toEqual([
      'wss://relay.damus.io',
      'wss://relay.edufeed.org',
      'Ditto'
    ]);
  });

  it('refuses without a list to edit — never fabricates one', async () => {
    getReplaceable.mockReturnValue(undefined);
    await expect(replaceDeadRelay('wss://nos.lol', 'wss://relay.primal.net', PK)).rejects.toThrow(
      /no relay list/i
    );
    expect(signEvent).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('refuses to publish a list that would end up empty', async () => {
    getReplaceable.mockReturnValue({ ...existing, tags: [['r', 'wss://nos.lol']] });
    await expect(replaceDeadRelay('wss://nos.lol', null, PK)).rejects.toThrow(/at least one/i);
    expect(publishEvent).not.toHaveBeenCalled();
  });
});
