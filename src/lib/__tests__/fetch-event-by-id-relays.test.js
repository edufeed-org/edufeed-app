// @ts-nocheck
/**
 * fetchEventById relay selection tests
 *
 * naddr relay hints may point to dead or thinly-replicated relays, so the
 * fetch must union them with the configured lookup relays instead of using
 * hints exclusively — mirroring the existing nevent behavior (edufeed-app#3).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { nip19 } from 'nostr-tools';

vi.mock('$lib/loaders', () => ({
  addressLoader: vi.fn(() => of(null)),
  eventLoader: vi.fn(() => of(null))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: vi.fn(() => ['wss://lookup.example']),
  getAppManagedRelays: vi.fn(() => [])
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  eventStore: {
    getReplaceable: vi.fn(() => null),
    getEvent: vi.fn(() => null)
  }
}));

import { addressLoader } from '$lib/loaders';
import { fetchEventById } from '$lib/helpers/nostrUtils';

const PUBKEY = 'a'.repeat(64);

describe('fetchEventById naddr relay selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unions naddr relay hints with lookup relays', async () => {
    const naddr = nip19.naddrEncode({
      kind: 31923,
      pubkey: PUBKEY,
      identifier: 'evt1',
      relays: ['wss://hint.example']
    });

    await fetchEventById(naddr);

    expect(addressLoader).toHaveBeenCalledTimes(1);
    const pointer = addressLoader.mock.calls[0][0];
    expect(pointer.relays).toEqual(
      expect.arrayContaining(['wss://hint.example', 'wss://lookup.example'])
    );
  });

  it('falls back to lookup relays when the naddr has no hints', async () => {
    const naddr = nip19.naddrEncode({
      kind: 31923,
      pubkey: PUBKEY,
      identifier: 'evt2',
      relays: []
    });

    await fetchEventById(naddr);

    const pointer = addressLoader.mock.calls[0][0];
    expect(pointer.relays).toEqual(['wss://lookup.example']);
  });
});
