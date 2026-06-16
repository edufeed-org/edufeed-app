/**
 * publishGiftWrap — routes a kind 1059 gift wrap ONLY to the recipient's DM
 * relays (NIP-17: "Clients MUST only publish events to the relays listed in the
 * recipient's kind 10050"). It must NOT fall back to the generic outbox model,
 * which would (a) blast every gift wrap to the app's fallback relays and (b)
 * waste a relay-list lookup on the throwaway wrapper key.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('publishGiftWrap', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let relayPublish;
  /** @type {{ relay: ReturnType<typeof vi.fn> }} */
  let pool;
  /** @type {ReturnType<typeof vi.fn>} */
  let getReadRelays;

  beforeEach(() => {
    relayPublish = vi.fn().mockResolvedValue(undefined);
    pool = { relay: vi.fn(() => ({ publish: relayPublish })) };
    getReadRelays = vi.fn();
  });

  /** @param {string[]} pTags */
  const giftWrap = (pTags = ['peer1']) => ({
    kind: 1059,
    pubkey: 'random_wrapper_key',
    tags: pTags.map((p) => ['p', p]),
    content: 'enc',
    id: 'gw1',
    sig: 'sig'
  });

  /** @param {any} event @param {string[]|undefined} relays */
  async function run(event, relays) {
    const { publishGiftWrap } = await import('$lib/services/gift-wrap-publish.js');
    return publishGiftWrap(event, relays, /** @type {any} */ ({ pool, getReadRelays }));
  }

  it('publishes only to the relays resolved by the action', async () => {
    const result = await run(giftWrap(), ['wss://dm.peer1']);

    expect(pool.relay).toHaveBeenCalledTimes(1);
    expect(pool.relay).toHaveBeenCalledWith('wss://dm.peer1');
    expect(relayPublish).toHaveBeenCalledTimes(1);
    expect(getReadRelays).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.relays).toEqual(['wss://dm.peer1']);
  });

  it('falls back to the recipient p-tag read relays when no relays are passed', async () => {
    getReadRelays.mockResolvedValue(['wss://read.peer1']);
    await run(giftWrap(['peer1']), undefined);

    expect(getReadRelays).toHaveBeenCalledWith('peer1');
    expect(pool.relay).toHaveBeenCalledWith('wss://read.peer1');
  });

  it('falls back when an empty relay array is passed', async () => {
    getReadRelays.mockResolvedValue(['wss://read.peer1']);
    await run(giftWrap(['peer1']), []);
    expect(getReadRelays).toHaveBeenCalledWith('peer1');
  });

  it('is a no-op when there is no recipient and no relays', async () => {
    const result = await run(giftWrap([]), undefined);
    expect(pool.relay).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it('reports success when at least one relay accepts', async () => {
    relayPublish.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(undefined);
    const result = await run(giftWrap(), ['wss://a', 'wss://b']);
    expect(result.successCount).toBe(1);
    expect(result.success).toBe(true);
  });

  it('reports failure when all relays reject', async () => {
    relayPublish.mockRejectedValue(new Error('nope'));
    const result = await run(giftWrap(), ['wss://a']);
    expect(result.success).toBe(false);
    expect(result.successCount).toBe(0);
  });
});
