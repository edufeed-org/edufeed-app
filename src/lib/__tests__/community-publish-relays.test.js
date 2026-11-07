// @ts-nocheck
/**
 * Relays community-targeted content must reach (Communikey: the `r` relays of
 * the community's kind 10222 are where its content is published). Derived
 * from the event's own `h` tags, so no caller has to remember to pass the
 * community event.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, NEVER } from 'rxjs';

const store = new Map();
vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: { getReplaceable: (kind, pubkey) => store.get(`${kind}:${pubkey}`) }
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: (c) => (c === 'communikey' ? ['wss://communikey.app/'] : [])
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.app/']
}));
const addressLoader = vi.fn();
vi.mock('$lib/loaders/base.js', () => ({ addressLoader: (p) => addressLoader(p) }));

import {
  getTargetCommunityPubkeys,
  resolveCommunityPublishRelays
} from '$lib/helpers/community-publish-relays.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const community = (pubkey, tags) => ({ kind: 10222, pubkey, tags, content: '', created_at: 1 });

beforeEach(() => {
  store.clear();
  addressLoader.mockReset();
  addressLoader.mockReturnValue(of());
});

describe('getTargetCommunityPubkeys', () => {
  it('keeps only 64-char lowercase hex h values, deduped — NIP-29 group ids never match', () => {
    const event = {
      tags: [
        ['h', A],
        ['h', A],
        ['h', '0b8e2c4a-1f3d-4c5e-9a7b-123456789abc'],
        ['h', A.toUpperCase()],
        ['h'],
        ['p', B]
      ]
    };
    expect(getTargetCommunityPubkeys(event)).toEqual([A]);
  });
});

describe('resolveCommunityPublishRelays', () => {
  it('returns nothing for an event without community targets', async () => {
    expect(await resolveCommunityPublishRelays(1, [])).toEqual([]);
  });

  it('unions communikey app relays with per-kind, global and enforced relays of each community', async () => {
    store.set(
      `10222:${A}`,
      community(A, [
        ['r', 'wss://a-global/'],
        ['r', 'wss://a-enforced/', 'enforced'],
        ['content', 'Article'],
        ['k', '30023'],
        ['r', 'wss://a-articles/']
      ])
    );
    store.set(`10222:${B}`, community(B, [['r', 'wss://b-global/']]));

    const relays = await resolveCommunityPublishRelays(30023, [A, B]);
    expect(relays).toEqual(
      expect.arrayContaining([
        'wss://communikey.app/',
        'wss://a-articles/',
        'wss://a-global/',
        'wss://a-enforced/',
        'wss://b-global/'
      ])
    );
    expect(addressLoader).not.toHaveBeenCalled();
  });

  it('fetches a community 10222 missing from the store, with explicit relays', async () => {
    addressLoader.mockImplementation(() => {
      const ev = community(A, [['r', 'wss://fetched/']]);
      store.set(`10222:${A}`, ev);
      return of(ev);
    });

    const relays = await resolveCommunityPublishRelays(1, [A]);
    expect(addressLoader).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 10222, pubkey: A, relays: ['wss://lookup.app/'] })
    );
    expect(relays).toEqual(expect.arrayContaining(['wss://communikey.app/', 'wss://fetched/']));
  });

  it('falls back to the communikey app relays when the 10222 never arrives (bounded wait)', async () => {
    vi.useFakeTimers();
    try {
      addressLoader.mockReturnValue(NEVER);
      const pending = resolveCommunityPublishRelays(1, [A]);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await pending).toEqual(['wss://communikey.app/']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses an explicitly passed community event without a lookup', async () => {
    const explicit = community(A, [['r', 'wss://explicit/']]);
    const relays = await resolveCommunityPublishRelays(1, [A], [explicit]);
    expect(relays).toContain('wss://explicit/');
    expect(addressLoader).not.toHaveBeenCalled();
  });
});
