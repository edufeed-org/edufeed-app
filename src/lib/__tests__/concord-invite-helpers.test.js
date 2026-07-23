/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { pickLatestChannelInvite, createChannelInviteOnce } from '$lib/concord/invite-helpers.js';

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
