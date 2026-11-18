/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { addressesFromResults, withPublishDeadline } from '../search-coordinator.js';

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

describe('withPublishDeadline', () => {
  // The SDK's relay pool retries a publish forever unless it gets an abort
  // signal, and its client transport passes none: with the transport relay
  // down, every search would leave a retry loop behind.
  class FakePool {
    publish(event, opts) {
      return Promise.resolve({ event, opts });
    }
  }

  it('gives every publish an abort signal and keeps the other options', async () => {
    const pool = new (withPublishDeadline(FakePool, 50))();
    const { event, opts } = await pool.publish('ev', { keep: true });
    expect(event).toBe('ev');
    expect(opts.keep).toBe(true);
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
    expect(opts.abortSignal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(opts.abortSignal.aborted).toBe(true);
  });
});
