/**
 * leaveWholeCommunity — the one "leave / unfollow this community" action
 * (issue c379c8ff): leave request on the root group, the community's groups
 * out of my kind-10009 list, then the unfollow.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const COMMUNITY = 'c'.repeat(64);
const ROOT = { id: 'root0000root0000', relay: 'wss://groups.example' };

/** @type {{ event: any, publish: any }} */
const state = vi.hoisted(() => ({ event: null, publish: null }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => ({})) },
  eventStore: {
    getReplaceable: vi.fn((/** @type {number} */ kind) => (kind === 10222 ? state.event : null))
  }
}));
const publishToGroupRelay = vi.hoisted(() =>
  vi.fn(async (/** @type {any[]} */ ...args) => state.publish?.(...args))
);
vi.mock('$lib/groups/group-management.js', () => ({ publishToGroupRelay }));
const updateListMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/groups/personal-groups-list.js', () => ({
  updatePersonalGroupsList: updateListMock
}));
const leaveCommunity = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('$lib/helpers/community.js', () => ({ leaveCommunity }));

import { leaveWholeCommunity } from '$lib/groups/leave-community.js';

const USER = { pubkey: 'f'.repeat(64), signer: {} };
const moderated = () => ({
  kind: 10222,
  pubkey: COMMUNITY,
  tags: [
    ['membership', ROOT.id, ROOT.relay],
    ['group', 'chan1', 'wss://groups.example/c/root0000root0000'],
    ['group', 'chan2', 'wss://groups.example/c/root0000root0000']
  ]
});

describe('leaveWholeCommunity', () => {
  beforeEach(() => {
    state.event = moderated();
    state.publish = null;
    publishToGroupRelay.mockClear();
    updateListMock.mockClear();
    leaveCommunity.mockClear();
  });

  it('sends the leave request for the root group, clears my list, unfollows', async () => {
    const result = await leaveWholeCommunity(COMMUNITY, USER);

    expect(result).toEqual({ success: true });
    expect(publishToGroupRelay).toHaveBeenCalledOnce();
    expect(publishToGroupRelay.mock.calls[0][1]).toMatchObject({
      kind: 9022,
      tags: [['h', ROOT.id]]
    });
    expect(updateListMock).toHaveBeenCalledWith(USER, {
      remove: [
        ROOT,
        expect.objectContaining({ id: 'chan1' }),
        expect.objectContaining({ id: 'chan2' })
      ]
    });
    expect(leaveCommunity).toHaveBeenCalledWith(COMMUNITY);
  });

  it('a community without a root group is a plain unfollow', async () => {
    state.event = { kind: 10222, pubkey: COMMUNITY, tags: [] };
    await leaveWholeCommunity(COMMUNITY, USER);

    expect(publishToGroupRelay).not.toHaveBeenCalled();
    expect(updateListMock).not.toHaveBeenCalled();
    expect(leaveCommunity).toHaveBeenCalledWith(COMMUNITY);
  });

  it('an unknown community event is a plain unfollow', async () => {
    state.event = null;
    await leaveWholeCommunity(COMMUNITY, USER);
    expect(publishToGroupRelay).not.toHaveBeenCalled();
    expect(leaveCommunity).toHaveBeenCalledWith(COMMUNITY);
  });

  it('not on the roster: still clears the list and unfollows', async () => {
    state.publish = async () => {
      throw new Error('blocked: unknown member');
    };
    const result = await leaveWholeCommunity(COMMUNITY, USER);

    expect(result).toEqual({ success: true });
    expect(updateListMock).toHaveBeenCalled();
    expect(leaveCommunity).toHaveBeenCalled();
  });

  it('the creator keeps the seat and the list, and only unfollows', async () => {
    state.publish = async () => {
      throw new Error('restricted: the group creator keeps the admin role');
    };
    const result = await leaveWholeCommunity(COMMUNITY, USER);

    expect(result).toEqual({ success: true });
    expect(updateListMock).not.toHaveBeenCalled();
    expect(leaveCommunity).toHaveBeenCalled();
  });

  it('a leave request that did not get through stops everything', async () => {
    state.publish = async () => {
      throw new Error('connection refused');
    };
    const result = await leaveWholeCommunity(COMMUNITY, USER);

    expect(result.success).toBe(false);
    expect(updateListMock).not.toHaveBeenCalled();
    expect(leaveCommunity).not.toHaveBeenCalled();
  });

  it('does not wait for the list write', async () => {
    updateListMock.mockReturnValueOnce(new Promise(() => {}));
    await expect(leaveWholeCommunity(COMMUNITY, USER)).resolves.toEqual({ success: true });
  });
});
