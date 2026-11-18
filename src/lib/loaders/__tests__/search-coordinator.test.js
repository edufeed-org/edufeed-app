/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { addressesFromResults } from '../search-coordinator.js';

describe('addressesFromResults', () => {
  const pubkey = 'ab'.repeat(32);
  const naddr = nip19.naddrEncode({ kind: 30142, pubkey, identifier: 'x', relays: [] });

  it('maps result naddrs to addresses in order and skips what does not decode', () => {
    expect(
      addressesFromResults([
        { naddr },
        { naddr: 'nonsense' },
        {},
        { naddr: nip19.npubEncode(pubkey) }
      ])
    ).toEqual([`30142:${pubkey}:x`]);
  });

  it('returns an empty list for anything that is not a list', () => {
    expect(addressesFromResults(undefined)).toEqual([]);
    expect(addressesFromResults({ results: [] })).toEqual([]);
  });
});
