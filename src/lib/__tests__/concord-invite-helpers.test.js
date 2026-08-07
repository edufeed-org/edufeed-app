/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  pickLatestChannelInvite,
  createChannelInviteOnce,
  resolveInviteWrap
} from '$lib/concord/invite-helpers.js';

describe('pickLatestChannelInvite', () => {
  it('returns undefined for an empty or missing link list', () => {
    expect(pickLatestChannelInvite([], 'c1')).toBeUndefined();
    expect(pickLatestChannelInvite(undefined, 'c1')).toBeUndefined();
  });

  it('ignores links that do not grant the channel', () => {
    const links = [{ channels: ['other'], revoked: false, createdAt: 100 }];
    expect(pickLatestChannelInvite(links, 'c1')).toBeUndefined();
  });

  it('ignores revoked links even if they grant the channel', () => {
    const links = [{ channels: ['c1'], revoked: true, createdAt: 200 }];
    expect(pickLatestChannelInvite(links, 'c1')).toBeUndefined();
  });

  it('picks the newest (highest createdAt) live link among several', () => {
    const oldest = { channels: ['c1'], revoked: false, createdAt: 100, token: 'a' };
    const newest = { channels: ['c1'], revoked: false, createdAt: 300, token: 'b' };
    const middle = { channels: ['c1'], revoked: false, createdAt: 200, token: 'c' };
    expect(pickLatestChannelInvite([oldest, newest, middle], 'c1')).toBe(newest);
  });

  it('a link with no channels array never matches (Omitted/empty grants none)', () => {
    const links = [{ revoked: false, createdAt: 100 }];
    expect(pickLatestChannelInvite(links, 'c1')).toBeUndefined();
  });

  it('matches by channel id for a private channel (default)', () => {
    const links = [
      { channels: ['chA'], revoked: false, createdAt: 2 },
      { channels: ['chB'], revoked: false, createdAt: 3 }
    ];
    expect(pickLatestChannelInvite(links, 'chA')?.createdAt).toBe(2);
  });

  it('reuses the latest AREA invite (empty channels) for a public channel', () => {
    const links = [
      { channels: [], revoked: false, createdAt: 5 },
      { channels: ['chA'], revoked: false, createdAt: 9 },
      { channels: [], revoked: false, createdAt: 7 }
    ];
    expect(pickLatestChannelInvite(links, 'general', false)?.createdAt).toBe(7);
  });

  it('ignores revoked area invites for a public channel', () => {
    const links = [
      { channels: [], revoked: true, createdAt: 9 },
      { channels: [], revoked: false, createdAt: 4 }
    ];
    expect(pickLatestChannelInvite(links, 'general', false)?.createdAt).toBe(4);
  });
});

describe('createChannelInviteOnce', () => {
  /** @param {any} [resolveWith] */
  function makeCommunity(resolveWith = { url: 'https://example.com/invite' }) {
    /** @type {(value: any) => void} */
    let resolve = () => {};
    /** @type {Promise<any>} */
    const pending = new Promise((r) => (resolve = r));
    const createInvite = vi.fn(() => pending);
    return {
      community: { communityId: 'community-1', createInvite },
      createInvite,
      settle: () => resolve(resolveWith)
    };
  }

  it('calls createInvite once and resolves to its result', async () => {
    const { community, createInvite, settle } = makeCommunity({ url: 'u1' });
    const promise = createChannelInviteOnce(community, 'chan-1', { base: 'x' });
    settle();
    await expect(promise).resolves.toEqual({ url: 'u1' });
    expect(createInvite).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent callers for the same community+channel onto one in-flight promise', async () => {
    const { community, createInvite, settle } = makeCommunity({ url: 'shared' });
    const first = createChannelInviteOnce(community, 'chan-1', { base: 'x' });
    const second = createChannelInviteOnce(community, 'chan-1', { base: 'x' });
    expect(first).toBe(second);
    settle();
    await Promise.all([first, second]);
    expect(createInvite).toHaveBeenCalledTimes(1);
  });

  it('does NOT dedupe different channels of the same community', async () => {
    let calls = 0;
    const createInvite = vi.fn(() => Promise.resolve({ url: `u${++calls}` }));
    const community = { communityId: 'community-1', createInvite };
    await createChannelInviteOnce(community, 'chan-1', {});
    await createChannelInviteOnce(community, 'chan-2', {});
    expect(createInvite).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry after settling, so a later call creates a fresh invite', async () => {
    const createInvite = vi
      .fn()
      .mockResolvedValueOnce({ url: 'first' })
      .mockResolvedValueOnce({ url: 'second' });
    const community = { communityId: 'community-2', createInvite };
    const first = await createChannelInviteOnce(community, 'chan-1', {});
    const second = await createChannelInviteOnce(community, 'chan-1', {});
    expect(first).toEqual({ url: 'first' });
    expect(second).toEqual({ url: 'second' });
    expect(createInvite).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry even when createInvite rejects, so a retry can succeed', async () => {
    const createInvite = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ url: 'retry-ok' });
    const community = { communityId: 'community-3', createInvite };
    await expect(createChannelInviteOnce(community, 'chan-1', {})).rejects.toThrow('network error');
    await expect(createChannelInviteOnce(community, 'chan-1', {})).resolves.toEqual({
      url: 'retry-ok'
    });
    expect(createInvite).toHaveBeenCalledTimes(2);
  });
});

describe('resolveInviteWrap', () => {
  // Mirrors applesauce-common's gift-wrap.js global-registry symbol contract:
  // rumor —Symbol.for('seal')→ Set<seal> —Symbol.for('gift-wrap')→ wrap.
  // The end-to-end proof against the real watcher/decrypt path lives in
  // concord-invite-dismiss.test.js; these cover the pure edge cases.
  const SealSymbol = Symbol.for('seal');
  const GiftWrapSymbol = Symbol.for('gift-wrap');

  it('walks rumor → seal → wrap and returns the wrap', () => {
    const wrap = { id: 'w'.repeat(64), kind: 1059 };
    const seal = { [GiftWrapSymbol]: wrap };
    const rumor = { id: 'r'.repeat(64), [SealSymbol]: new Set([seal]) };
    expect(resolveInviteWrap({ rumor })).toBe(wrap);
  });

  it('skips seals without a wrap backlink and finds one that has it', () => {
    const wrap = { id: 'w'.repeat(64), kind: 1059 };
    const orphanSeal = {};
    const linkedSeal = { [GiftWrapSymbol]: wrap };
    const rumor = { id: 'r'.repeat(64), [SealSymbol]: new Set([orphanSeal, linkedSeal]) };
    expect(resolveInviteWrap({ rumor })).toBe(wrap);
  });

  it('returns undefined for missing backlinks, missing rumor, and nullish input', () => {
    expect(resolveInviteWrap({ rumor: { id: 'r'.repeat(64) } })).toBeUndefined();
    expect(
      resolveInviteWrap({ rumor: { id: 'r'.repeat(64), [SealSymbol]: new Set([{}]) } })
    ).toBeUndefined();
    expect(resolveInviteWrap({})).toBeUndefined();
    expect(resolveInviteWrap(undefined)).toBeUndefined();
    expect(resolveInviteWrap(null)).toBeUndefined();
  });
});
