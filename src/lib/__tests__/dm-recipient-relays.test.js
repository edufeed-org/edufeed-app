/**
 * ensureRecipientDmRelays — loads each recipient's kind 10050 DM relay list
 * (and kind 10002 mailboxes as fallback) into the EventStore before sending a
 * wrapped DM. The applesauce SendWrappedMessage action resolves recipient
 * relays from the store only (never the network), so without this prefetch a
 * brand-new conversation has no recipient relays and the gift wrap can't be
 * routed per NIP-17.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('ensureRecipientDmRelays', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let getReplaceable;
  /** @type {ReturnType<typeof vi.fn>} */
  let load;

  beforeEach(() => {
    getReplaceable = vi.fn().mockReturnValue(undefined);
    load = vi.fn().mockResolvedValue(undefined);
  });

  /** @param {string[]} pubkeys @param {object} [extra] */
  async function run(pubkeys, extra = {}) {
    const { ensureRecipientDmRelays } = await import('$lib/services/dm-recipient-relays.js');
    return ensureRecipientDmRelays(
      pubkeys,
      /** @type {any} */ ({
        store: { getReplaceable },
        load,
        getLookupRelays: () => ['wss://index.example'],
        getFallbackRelays: () => [],
        ...extra
      })
    );
  }

  it('loads kind 10050 and 10002 for a recipient not yet in the store', async () => {
    await run(['peer1']);

    expect(load).toHaveBeenCalledWith(10050, 'peer1', ['wss://index.example'], expect.any(Number));
    expect(load).toHaveBeenCalledWith(10002, 'peer1', ['wss://index.example'], expect.any(Number));
  });

  it('skips a kind already present in the store', async () => {
    getReplaceable.mockImplementation((kind) => (kind === 10050 ? { kind: 10050 } : undefined));
    await run(['peer1']);

    const kindsLoaded = load.mock.calls.map((c) => c[0]);
    expect(kindsLoaded).toEqual([10002]);
  });

  it('does nothing when both lists are already in the store', async () => {
    getReplaceable.mockReturnValue({ kind: 10050 });
    await run(['peer1']);
    expect(load).not.toHaveBeenCalled();
  });

  it('handles multiple recipients', async () => {
    await run(['peer1', 'peer2']);
    const targets = load.mock.calls.map((c) => `${c[0]}:${c[1]}`);
    expect(targets).toContain('10050:peer1');
    expect(targets).toContain('10050:peer2');
  });

  it('unions lookup relays with fallback relays', async () => {
    await run(['peer1'], {
      getLookupRelays: () => ['wss://index.example'],
      getFallbackRelays: () => ['wss://fallback.example']
    });
    const relaysArg = load.mock.calls[0][2];
    expect(relaysArg).toContain('wss://index.example');
    expect(relaysArg).toContain('wss://fallback.example');
  });

  it('is a no-op when there are no relays to query', async () => {
    await run(['peer1'], { getLookupRelays: () => [], getFallbackRelays: () => [] });
    expect(load).not.toHaveBeenCalled();
  });
});
