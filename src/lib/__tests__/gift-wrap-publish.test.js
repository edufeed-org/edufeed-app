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
  let poolPublish;
  /** @type {{ publish: ReturnType<typeof vi.fn> }} */
  let pool;
  /** @type {ReturnType<typeof vi.fn>} */
  let getReadRelays;

  /**
   * Shape a pool.publish result the way applesauce does: one PublishResponse
   * per target relay. A relay that could not be reached is not an exception —
   * the library catches it and reports { ok: false } for that relay — so these
   * stubs answer per relay rather than throwing.
   * @param {(url: string, index: number) => boolean} okFor
   */
  const respondPerRelay = (okFor) =>
    vi.fn(async (/** @type {string[]} */ relays) =>
      relays.map((from, i) => ({ ok: okFor(from, i), from, message: okFor(from, i) ? '' : 'nope' }))
    );

  beforeEach(() => {
    poolPublish = respondPerRelay(() => true);
    pool = { publish: poolPublish };
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

    expect(poolPublish).toHaveBeenCalledTimes(1);
    expect(poolPublish.mock.calls[0][0]).toEqual(['wss://dm.peer1']);
    expect(getReadRelays).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.relays).toEqual(['wss://dm.peer1']);
  });

  it('bounds the publish instead of taking the library defaults', async () => {
    // applesauce defaults to a 30s timeout and 3 retries. Behind a send button
    // that is a minute and a half of nothing; the caller must cap both.
    await run(giftWrap(), ['wss://dm.peer1']);

    const opts = poolPublish.mock.calls[0][2];
    expect(opts.timeout).toBe(5000);
    expect(opts.retries).toBeLessThanOrEqual(2);
  });

  it('falls back to the recipient p-tag read relays when no relays are passed', async () => {
    getReadRelays.mockResolvedValue(['wss://read.peer1']);
    await run(giftWrap(['peer1']), undefined);

    expect(getReadRelays).toHaveBeenCalledWith('peer1');
    expect(poolPublish.mock.calls[0][0]).toEqual(['wss://read.peer1']);
  });

  it('falls back when an empty relay array is passed', async () => {
    getReadRelays.mockResolvedValue(['wss://read.peer1']);
    await run(giftWrap(['peer1']), []);
    expect(getReadRelays).toHaveBeenCalledWith('peer1');
  });

  it('is a no-op when there is no recipient and no relays', async () => {
    const result = await run(giftWrap([]), undefined);
    expect(poolPublish).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it('reports success when at least one relay accepts', async () => {
    poolPublish.mockImplementation(async (/** @type {string[]} */ relays) =>
      relays.map((from, i) => ({ ok: i === 1, from }))
    );
    const result = await run(giftWrap(), ['wss://a', 'wss://b']);
    expect(result.successCount).toBe(1);
    expect(result.success).toBe(true);
  });

  it('reports failure when all relays reject', async () => {
    poolPublish = respondPerRelay(() => false);
    pool.publish = poolPublish;
    const result = await run(giftWrap(), ['wss://a']);
    expect(result.success).toBe(false);
    expect(result.successCount).toBe(0);
  });

  it('counts a relay that answers OK: false as a failure, not a delivery', async () => {
    // A relay REJECTING an event resolves with {ok:false}; only an unreachable
    // relay produces an error, and applesauce reports that as {ok:false} too.
    // Either way, counting it as delivered tells the sender their DM landed
    // when no relay took it.
    poolPublish.mockResolvedValue([
      { ok: false, message: 'blocked: not allowed', from: 'wss://a' },
      { ok: false, message: 'blocked: not allowed', from: 'wss://b' }
    ]);
    const result = await run(giftWrap(), ['wss://a', 'wss://b']);

    expect(result.success).toBe(false);
    expect(result.successCount).toBe(0);
  });

  it('does not count a malformed response as a delivery', async () => {
    // Defensive: the old hand-rolled loop treated "no response object" as
    // success, so anything that failed to answer in the expected shape was
    // reported as a delivered DM. Absence of a NO is not a YES.
    poolPublish.mockResolvedValue([undefined, { from: 'wss://b' }]);
    const result = await run(giftWrap(), ['wss://a', 'wss://b']);

    expect(result.success).toBe(false);
    expect(result.successCount).toBe(0);
  });

  it('still reports success when one relay rejects and another accepts', async () => {
    poolPublish.mockResolvedValue([
      { ok: false, message: 'blocked', from: 'wss://a' },
      { ok: true, from: 'wss://b' }
    ]);
    const result = await run(giftWrap(), ['wss://a', 'wss://b']);

    expect(result.success).toBe(true);
    expect(result.successCount).toBe(1);
  });
});
