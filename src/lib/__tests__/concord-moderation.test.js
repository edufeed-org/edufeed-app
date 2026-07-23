/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { channelMemberList, kickFromChannel, banFromChannel } from '$lib/concord/moderation.js';

describe('channelMemberList', () => {
  it('unions observed + granted + self, deduped, self first', () => {
    expect(channelMemberList({ observed: ['a', 'b'], granted: ['b', 'c'], self: 'me' })).toEqual([
      'me',
      'a',
      'b',
      'c'
    ]);
  });

  it('omits self when undefined (logged-out edge case)', () => {
    expect(channelMemberList({ observed: ['a'], granted: [], self: undefined })).toEqual(['a']);
  });

  it('dedupes repeats within observed/granted themselves', () => {
    expect(channelMemberList({ observed: ['a', 'a'], granted: ['a'], self: 'a' })).toEqual(['a']);
  });

  it('returns an empty array when everything is empty', () => {
    expect(channelMemberList({ observed: [], granted: [], self: undefined })).toEqual([]);
  });
});

describe('kickFromChannel / banFromChannel', () => {
  const community = () => ({
    rotateChannel: vi.fn().mockResolvedValue(undefined),
    ban: vi.fn().mockResolvedValue(undefined)
  });

  it('kick rotates keeping everyone but the member, without banning', async () => {
    const c = community();
    await kickFromChannel(c, 'chan1', 'evil', ['me', 'evil', 'friend'], 'me');
    expect(c.rotateChannel).toHaveBeenCalledWith('chan1', {
      keep: ['me', 'friend'],
      exclude: ['evil']
    });
    expect(c.ban).not.toHaveBeenCalled();
  });

  it('ban banlists AND rotates', async () => {
    const c = community();
    await banFromChannel(c, 'chan1', 'evil', ['me', 'evil'], 'me');
    expect(c.ban).toHaveBeenCalledWith('evil');
    expect(c.rotateChannel).toHaveBeenCalledWith('chan1', { keep: ['me'], exclude: ['evil'] });
  });

  it('ban calls community.ban before rotateChannel (banlist should land even if rotation fails)', async () => {
    const order = /** @type {string[]} */ ([]);
    const c = {
      ban: vi.fn().mockImplementation(async () => {
        order.push('ban');
      }),
      rotateChannel: vi.fn().mockImplementation(async () => {
        order.push('rotate');
      })
    };
    await banFromChannel(c, 'chan1', 'evil', ['me', 'evil'], 'me');
    expect(order).toEqual(['ban', 'rotate']);
  });

  // Self-target guard: for the OWNER, rotateChannel's outrank check
  // short-circuits (canActOn: actor.isOwner → true, no self-check), so an
  // owner in `exclude` would pass the dist's guards and silently lose the
  // channel key. moderation.js must refuse before reaching the dist.
  it('kick throws on self-target without touching the community', async () => {
    const c = community();
    await expect(kickFromChannel(c, 'chan1', 'me', ['me', 'friend'], 'me')).rejects.toThrow(
      'refusing to remove self from channel'
    );
    expect(c.rotateChannel).not.toHaveBeenCalled();
    expect(c.ban).not.toHaveBeenCalled();
  });

  it('ban throws on self-target without banlisting or rotating', async () => {
    const c = community();
    await expect(banFromChannel(c, 'chan1', 'me', ['me', 'friend'], 'me')).rejects.toThrow(
      'refusing to remove self from channel'
    );
    expect(c.ban).not.toHaveBeenCalled();
    expect(c.rotateChannel).not.toHaveBeenCalled();
  });
});
