/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

const callTool = vi.fn();
vi.mock('@contextvm/mcp-sdk/client', () => ({
  Client: class {
    connect() {}
    callTool = callTool;
  }
}));
vi.mock('@contextvm/sdk', () => ({
  ApplesauceRelayPool: class {},
  NostrClientTransport: class {},
  PrivateKeySigner: class {},
  EncryptionMode: {},
  GiftWrapMode: {}
}));

const { addressesFromResults, withPublishDeadline, searchArguments, coordinatorOrder } =
  await import('../search-coordinator.js');

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

describe('searchArguments', () => {
  it('passes the relays the app searches', () => {
    expect(searchArguments('mathe', ['wss://one', 'wss://two'], 50)).toEqual({
      query: 'mathe',
      types: ['resource'],
      limit: 50,
      relays: ['wss://one', 'wss://two']
    });
  });

  it('sends no relays key for an empty relay list', () => {
    expect(searchArguments('mathe', [], 50)).not.toHaveProperty('relays');
    expect(searchArguments('mathe', undefined, 50)).not.toHaveProperty('relays');
  });
});

describe('coordinatorOrder', () => {
  const pubkey = 'cd'.repeat(32);
  const coordinator = { pubkey, relays: ['wss://transport'] };
  const naddr = nip19.naddrEncode({ kind: 30142, pubkey, identifier: 'x', relays: [] });
  const body = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

  it('asks search_content for the given relays and returns the order', async () => {
    callTool.mockResolvedValueOnce(body({ results: [{ naddr }] }));
    expect(await coordinatorOrder(coordinator, 'mathe', { relays: ['wss://one'] })).toEqual([
      `30142:${pubkey}:x`
    ]);
    expect(callTool.mock.calls[0][0]).toEqual({
      name: 'search_content',
      arguments: { query: 'mathe', types: ['resource'], limit: 50, relays: ['wss://one'] }
    });
  });

  it('returns null for an error payload (a body without results)', async () => {
    callTool.mockResolvedValueOnce(body({ error: 'unknown relay: wss://one' }));
    expect(await coordinatorOrder(coordinator, 'mathe', { relays: ['wss://one'] })).toBeNull();
  });
});
