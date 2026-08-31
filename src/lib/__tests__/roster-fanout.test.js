/** @vitest-environment node */
/**
 * roster-fanout.js — Task 1. Ported verbatim from AreaMembersModal's local
 * tryOnce/fanOut/putUserOn/removeUserOn, with one signature change: the
 * put/remove helpers take an explicit `user` param instead of reading the
 * active user internally (see brief).
 */
import { describe, it, expect, vi } from 'vitest';

const { relaySentinel, poolRelay } = vi.hoisted(() => {
  const relaySentinel = { __sentinel: 'relay-conn' };
  return { relaySentinel, poolRelay: vi.fn(() => relaySentinel) };
});

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: poolRelay }
}));

// Pass-through spies: same shape as the real builders, but we only need to
// assert they were invoked with the right args and that their return value
// flows into publishToGroupRelay.
const { buildPutUserTemplate, buildRemoveUserTemplate, publishToGroupRelay } = vi.hoisted(() => ({
  buildPutUserTemplate: vi.fn((groupId, pubkey, roles) => ({
    __sentinel: 'put',
    groupId,
    pubkey,
    roles
  })),
  buildRemoveUserTemplate: vi.fn((groupId, pubkey) => ({
    __sentinel: 'remove',
    groupId,
    pubkey
  })),
  publishToGroupRelay: vi.fn(() => Promise.resolve({ id: 'signed' }))
}));

vi.mock('$lib/groups/group-management.js', () => ({
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  publishToGroupRelay
}));

const { putUserOn, removeUserOn, tryOnce, fanOut } = await import('$lib/groups/roster-fanout.js');

const USER = { pubkey: 'a'.repeat(64), signer: {} };
const POINTER = { id: 'chan-a', relay: 'wss://relay.test/' };
const PUBKEY = 'b'.repeat(64);

describe('putUserOn', () => {
  it('builds the put-user template and publishes to the pointer relay with the given user', async () => {
    poolRelay.mockClear();
    publishToGroupRelay.mockClear();
    buildPutUserTemplate.mockClear();

    await putUserOn(POINTER, PUBKEY, ['admin'], USER);

    expect(buildPutUserTemplate).toHaveBeenCalledWith('chan-a', PUBKEY, ['admin']);
    expect(poolRelay).toHaveBeenCalledWith(POINTER.relay);
    expect(publishToGroupRelay).toHaveBeenCalledWith(
      relaySentinel,
      { __sentinel: 'put', groupId: 'chan-a', pubkey: PUBKEY, roles: ['admin'] },
      USER
    );
  });

  it('defaults roles to []', async () => {
    buildPutUserTemplate.mockClear();
    await putUserOn(POINTER, PUBKEY, undefined, USER);
    expect(buildPutUserTemplate).toHaveBeenCalledWith('chan-a', PUBKEY, []);
  });
});

describe('removeUserOn', () => {
  it('builds the remove-user template and publishes to the pointer relay with the given user', async () => {
    poolRelay.mockClear();
    publishToGroupRelay.mockClear();
    buildRemoveUserTemplate.mockClear();

    await removeUserOn(POINTER, PUBKEY, USER);

    expect(buildRemoveUserTemplate).toHaveBeenCalledWith('chan-a', PUBKEY);
    expect(poolRelay).toHaveBeenCalledWith(POINTER.relay);
    expect(publishToGroupRelay).toHaveBeenCalledWith(
      relaySentinel,
      { __sentinel: 'remove', groupId: 'chan-a', pubkey: PUBKEY },
      USER
    );
  });
});

describe('tryOnce', () => {
  it('resolves true on first success without a retry', async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const ok = await tryOnce('item', 'label', action);
    expect(ok).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('retries once, resolves true if the retry succeeds', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error('first fails'))
      .mockResolvedValueOnce(undefined);
    const ok = await tryOnce('item', 'label', action);
    expect(ok).toBe(true);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('retries once, then reports {ok: false} without throwing when both attempts fail', async () => {
    const action = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(tryOnce('item', 'label', action)).resolves.toBe(false);
    expect(action).toHaveBeenCalledTimes(2);
  });
});

describe('fanOut', () => {
  it('runs items sequentially (not in parallel) and aggregates ok/failed via aggregateFanOut', async () => {
    /** @type {string[]} */
    const order = [];
    const items = ['x', 'y', 'z'];
    const action = vi.fn(async (/** @type {string} */ item) => {
      order.push(`start:${item}`);
      // yield a microtask so a parallel implementation would interleave.
      await Promise.resolve();
      if (item === 'y') throw new Error('y always fails');
      order.push(`end:${item}`);
    });

    const aggregate = await fanOut(items, (item) => item, action);

    // Sequential: each item starts only after the previous one's action
    // settled (y fails twice — start/fail, start/fail — with no interleaved
    // start from x or z).
    expect(order).toEqual(['start:x', 'end:x', 'start:y', 'start:y', 'start:z', 'end:z']);
    expect(aggregate).toEqual({ ok: ['x', 'z'], failed: ['y'] });
  });

  it('never throws even when every item fails both attempts', async () => {
    const action = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(fanOut(['a', 'b'], (item) => item, action)).resolves.toEqual({
      ok: [],
      failed: ['a', 'b']
    });
  });
});
