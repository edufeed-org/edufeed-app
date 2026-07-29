/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { shouldShowChannelsTab, deriveVisibleChannels } from '$lib/concord/community.svelte.js';
import { memberTier } from '$lib/concord/roles.js';

describe('shouldShowChannelsTab', () => {
  const base = { enabled: true, pointer: undefined, isOwner: false, isMember: false };
  it('hidden when flag off, regardless of everything else', () => {
    expect(
      shouldShowChannelsTab({ ...base, enabled: false, pointer: {}, isOwner: true, isMember: true })
    ).toBe(false);
  });
  it('visible for members even without pointer (invite-first join)', () => {
    expect(shouldShowChannelsTab({ ...base, isMember: true })).toBe(true);
  });
  it('visible when pointer exists (non-member sees invite inbox)', () => {
    expect(shouldShowChannelsTab({ ...base, pointer: { communityId: 'x' } })).toBe(true);
  });
  it('visible for owner without pointer (founding affordance)', () => {
    expect(shouldShowChannelsTab({ ...base, isOwner: true })).toBe(true);
  });
  it('hidden otherwise', () => {
    expect(shouldShowChannelsTab(base)).toBe(false);
  });
});

// This test file has no harness driving `roles$`/`grants$` through the
// runes-based `useConcordArea`/`useConcordCommunity` hooks (those need a
// component-test environment with $effect support, which this file's plain
// `node` environment doesn't provide). Per the task brief, lock the
// tier→capability mapping directly: these are the exact boolean expressions
// `community.svelte.js` computes from `myTier` in its returned object.
describe('concord hook capability mapping (myTier -> capability booleans)', () => {
  /** @param {'owner'|'admin'|'moderator'|null} myTier */
  function capabilities(myTier) {
    return {
      myTier,
      canManageChannels: myTier === 'owner' || myTier === 'admin',
      canCreateInvite: myTier === 'owner' || myTier === 'admin' || myTier === 'moderator',
      canModerate: myTier === 'owner' || myTier === 'admin' || myTier === 'moderator',
      canManageRoles: myTier === 'owner' || myTier === 'admin',
      canPromoteAdmin: myTier === 'owner'
    };
  }

  const ADMIN_PERMS_STR = (
    (1n << 0n) |
    (1n << 1n) |
    (1n << 2n) |
    (1n << 3n) |
    (1n << 4n) |
    (1n << 5n) |
    (1n << 6n) |
    (1n << 8n) |
    (1n << 9n)
  ).toString();
  const MOD_PERMS_STR = ((1n << 3n) | (1n << 4n) | (1n << 5n) | (1n << 6n)).toString();

  const owner = 'owner-pubkey';
  const admin = 'admin-pubkey';
  const moderator = 'moderator-pubkey';
  const roleless = 'roleless-pubkey';
  const roles = [
    { role_id: 'admin-role', permissions: ADMIN_PERMS_STR, scope: { kind: 'server' } },
    { role_id: 'mod-role', permissions: MOD_PERMS_STR, scope: { kind: 'server' } }
  ];
  const grants = new Map([
    [admin, ['admin-role']],
    [moderator, ['mod-role']]
  ]);

  it('owner: full capabilities including promote-to-admin', () => {
    const tier = memberTier(roles, grants, owner, owner);
    expect(tier).toBe('owner');
    expect(capabilities(tier)).toEqual({
      myTier: 'owner',
      canManageChannels: true,
      canCreateInvite: true,
      canModerate: true,
      canManageRoles: true,
      canPromoteAdmin: true
    });
  });

  it('admin: manage channels/roles + moderate, but cannot promote to admin', () => {
    const tier = memberTier(roles, grants, owner, admin);
    expect(tier).toBe('admin');
    expect(capabilities(tier)).toEqual({
      myTier: 'admin',
      canManageChannels: true,
      canCreateInvite: true,
      canModerate: true,
      canManageRoles: true,
      canPromoteAdmin: false
    });
  });

  it('moderator: can invite/moderate, but cannot manage channels/roles or promote', () => {
    const tier = memberTier(roles, grants, owner, moderator);
    expect(tier).toBe('moderator');
    expect(capabilities(tier)).toEqual({
      myTier: 'moderator',
      canManageChannels: false,
      canCreateInvite: true,
      canModerate: true,
      canManageRoles: false,
      canPromoteAdmin: false
    });
  });

  it('roleless member: every capability is false', () => {
    const tier = memberTier(roles, grants, owner, roleless);
    expect(tier).toBe(null);
    expect(capabilities(tier)).toEqual({
      myTier: null,
      canManageChannels: false,
      canCreateInvite: false,
      canModerate: false,
      canManageRoles: false,
      canPromoteAdmin: false
    });
  });

  it('no active user (not logged in / not loaded yet): every capability is false', () => {
    const tier = memberTier(roles, grants, owner, undefined);
    expect(tier).toBe(null);
    expect(capabilities(tier)).toEqual({
      myTier: null,
      canManageChannels: false,
      canCreateInvite: false,
      canModerate: false,
      canManageRoles: false,
      canPromoteAdmin: false
    });
  });
});

describe('deriveVisibleChannels', () => {
  it('includes a public channel and marks it accessible even without a held key', () => {
    const channels = [{ channel_id: 'general', private: false }];
    expect(deriveVisibleChannels(channels, [])).toEqual([
      { channel_id: 'general', private: false, accessible: true }
    ]);
  });

  it('includes a private channel with a held key and marks it accessible', () => {
    const channels = [{ channel_id: 'secret', private: true }];
    expect(deriveVisibleChannels(channels, ['secret'])).toEqual([
      { channel_id: 'secret', private: true, accessible: true }
    ]);
  });

  it('includes a private channel without a held key but marks it inaccessible', () => {
    const channels = [{ channel_id: 'secret', private: true }];
    expect(deriveVisibleChannels(channels, [])).toEqual([
      { channel_id: 'secret', private: true, accessible: false }
    ]);
  });

  it('drops deleted channels regardless of privacy or held keys', () => {
    const channels = [
      { channel_id: 'general', private: false, deleted: true },
      { channel_id: 'secret', private: true, deleted: true }
    ];
    expect(deriveVisibleChannels(channels, ['secret'])).toEqual([]);
  });

  it('preserves other channel fields untouched', () => {
    const channels = [{ channel_id: 'general', private: false, name: 'General' }];
    expect(deriveVisibleChannels(channels, [])).toEqual([
      { channel_id: 'general', private: false, name: 'General', accessible: true }
    ]);
  });
});
