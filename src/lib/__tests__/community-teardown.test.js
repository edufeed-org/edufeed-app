/** @vitest-environment node */
// The destructive NIP-29 teardown: delete every channel group + the root
// membership group on the relay (kind 9008), then strip all pointers off the
// 10222 (revert to open), prune the owner's 10009, and clear the founding
// marker. Relay deletes are best-effort — a group whose relay is down or is
// already gone must NOT block the load-bearing 10222 revert.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishToGroupRelay = vi.hoisted(() => vi.fn().mockResolvedValue({ kind: 9008 }));
const buildDeleteGroupTemplate = vi.hoisted(() =>
  vi.fn((/** @type {string} */ id) => ({ kind: 9008, tags: [['h', id]] }))
);
vi.mock('$lib/groups/group-management.js', () => ({
  publishToGroupRelay,
  buildDeleteGroupTemplate
}));

const publishCommunityUpdate = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'flip' }));
vi.mock('$lib/helpers/publishCommunityUpdate.js', () => ({ publishCommunityUpdate }));

const updatePersonalGroupsList = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/groups/personal-groups-list.js', () => ({ updatePersonalGroupsList }));

const detachGroupChannel = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/groups/community-attach.js', () => ({ detachGroupChannel }));

const clearRootGroupMarker = vi.hoisted(() => vi.fn());
vi.mock('$lib/groups/provision-root-group.js', () => ({ clearRootGroupMarker }));

const relayConn = vi.hoisted(() => ({ mocked: true }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relayConn) }
}));

const { teardownCommunityGroups, deleteChannelCascade } = await import(
  '$lib/groups/community-teardown.js'
);

const GROUPS_RELAY = 'wss://groups.example/';
const OWNER = 'a'.repeat(64);
const user = { pubkey: OWNER, signer: { sign: () => {} } };

// A moderated community: two channels + a membership (root) pointer.
const communikeyEvent = {
  kind: 10222,
  pubkey: OWNER,
  created_at: 1000,
  content: '',
  tags: [
    ['d', 'edufeed'],
    ['name', 'My Community'],
    ['membership', 'root0', GROUPS_RELAY],
    ['group', 'chan1', GROUPS_RELAY, 'Willkommen'],
    ['group', 'chan2', GROUPS_RELAY, 'Intern']
  ]
};

beforeEach(() => {
  publishToGroupRelay.mockClear().mockResolvedValue({ kind: 9008 });
  buildDeleteGroupTemplate.mockClear();
  publishCommunityUpdate.mockClear().mockResolvedValue({ id: 'flip' });
  updatePersonalGroupsList.mockClear().mockResolvedValue(undefined);
  detachGroupChannel.mockClear();
  clearRootGroupMarker.mockClear();
});

describe('teardownCommunityGroups', () => {
  it('deletes every channel + the root group, reverts the 10222, prunes 10009, clears marker', async () => {
    await teardownCommunityGroups({ communikeyEvent, communitySigner: {}, user });

    // A 9008 delete for each channel AND the root membership id.
    const deletedIds = buildDeleteGroupTemplate.mock.calls.map((c) => c[0]).sort();
    expect(deletedIds).toEqual(['chan1', 'chan2', 'root0']);
    expect(publishToGroupRelay).toHaveBeenCalledTimes(3);

    // The load-bearing revert: a flip-to-open 10222 with NO membership/group tags.
    expect(publishCommunityUpdate).toHaveBeenCalledOnce();
    const flipTemplate = publishCommunityUpdate.mock.calls[0][0];
    const keys = flipTemplate.tags.map((/** @type {string[]} */ t) => t[0]);
    expect(keys).not.toContain('membership');
    expect(keys).not.toContain('group');

    // Owner's 10009 pruned of root + both channels in one call.
    expect(updatePersonalGroupsList).toHaveBeenCalledOnce();
    const removeArg = updatePersonalGroupsList.mock.calls[0][1].remove;
    expect(removeArg.map((/** @type {any} */ p) => p.id).sort()).toEqual([
      'chan1',
      'chan2',
      'root0'
    ]);

    expect(clearRootGroupMarker).toHaveBeenCalledWith(OWNER);
  });

  it('a failed group delete does not block the 10222 revert (best-effort)', async () => {
    publishToGroupRelay.mockRejectedValue(new Error('relay down'));
    await expect(
      teardownCommunityGroups({ communikeyEvent, communitySigner: {}, user })
    ).resolves.toBeUndefined();
    // The revert still ran despite every group delete rejecting.
    expect(publishCommunityUpdate).toHaveBeenCalledOnce();
    expect(clearRootGroupMarker).toHaveBeenCalledWith(OWNER);
  });

  it('propagates a failed 10222 revert (load-bearing)', async () => {
    publishCommunityUpdate.mockRejectedValue(new Error('sign refused'));
    await expect(
      teardownCommunityGroups({ communikeyEvent, communitySigner: {}, user })
    ).rejects.toThrow('sign refused');
  });

  // Channels are DISCOVERED from the subtree now, not the 10222 — the caller
  // passes them. A community whose 10222 carries no `group` pointers still tears
  // its channels down through the passed list.
  it('deletes the caller-passed subtree channels + root (not the 10222 pointers)', async () => {
    const bareRoot = {
      kind: 10222,
      pubkey: OWNER,
      content: '',
      tags: [
        ['d', 'edufeed'],
        ['membership', 'root0', GROUPS_RELAY]
      ]
    };
    await teardownCommunityGroups({
      communikeyEvent: bareRoot,
      communitySigner: {},
      user,
      channels: [
        { id: 'chanA', relay: 'wss://groups.example/c/root0' },
        { id: 'chanB', relay: 'wss://groups.example/c/root0' }
      ]
    });
    const deletedIds = buildDeleteGroupTemplate.mock.calls.map((c) => c[0]).sort();
    expect(deletedIds).toEqual(['chanA', 'chanB', 'root0']);
  });

  // Legacy community: some channels are still old-scheme kind-10222 `group`
  // pointers (not subtree subgroups). Teardown must delete BOTH the passed
  // subtree channels AND the legacy pointers, deduped by id.
  it('unions passed subtree channels with legacy 10222 group pointers, deduped', async () => {
    await teardownCommunityGroups({
      communikeyEvent, // carries group pointers chan1, chan2 + membership root0
      communitySigner: {},
      user,
      // chan1 also appears in the subtree (dedup), plus a subtree-only chanX.
      channels: [
        { id: 'chan1', relay: 'wss://groups.example/c/root0' },
        { id: 'chanX', relay: 'wss://groups.example/c/root0' }
      ]
    });
    const deletedIds = buildDeleteGroupTemplate.mock.calls.map((c) => c[0]).sort();
    // chan1 once (deduped), chan2 (legacy only), chanX (subtree only), root0.
    expect(deletedIds).toEqual(['chan1', 'chan2', 'chanX', 'root0']);
  });
});

describe('deleteChannelCascade', () => {
  const pointer = { id: 'chan1', relay: GROUPS_RELAY };

  it('deletes one group and prunes it from the user 10009 — no 10222 pointer to detach', async () => {
    await deleteChannelCascade({ pointer, user });

    expect(buildDeleteGroupTemplate).toHaveBeenCalledWith('chan1');
    expect(publishToGroupRelay).toHaveBeenCalledOnce();
    expect(updatePersonalGroupsList).toHaveBeenCalledWith(user, { remove: pointer });
    // No owner-signed 10222 edit any more — the 9008 drops the subgroup from
    // the /c subtree, so every client stops discovering it.
    expect(detachGroupChannel).not.toHaveBeenCalled();
  });

  it('propagates a failed group delete (load-bearing step)', async () => {
    publishToGroupRelay.mockRejectedValue(new Error('not admin'));
    await expect(deleteChannelCascade({ pointer, user })).rejects.toThrow('not admin');
  });
});
