/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { shouldShowChannelsTab, deriveVisibleChannels } from '$lib/concord/community.svelte.js';
import { memberTier, ADMIN_PERMS, MOD_PERMS } from '$lib/concord/roles.js';

describe('shouldShowChannelsTab', () => {
  const base = { enabled: true, pointer: undefined, isMember: false };
  it('hidden when flag off, whatever the Concord side says', () => {
    expect(shouldShowChannelsTab({ ...base, enabled: false, pointer: {}, isMember: true })).toBe(
      false
    );
  });
  // A community extended by NIP-29 groups has no Concord area, no Concord
  // pointer and no Concord membership — every input above is false for it.
  // Gating its channels on the Concord flag would hide the only list they
  // have.
  it('visible for a community with group channels, even with the flag off', () => {
    expect(shouldShowChannelsTab({ ...base, enabled: false, hasGroupChannels: true })).toBe(true);
  });
  it('visible for a stranger when the community lists group channels', () => {
    expect(shouldShowChannelsTab({ ...base, hasGroupChannels: true })).toBe(true);
  });
  it('still hidden for a stranger with the flag on and no channels anywhere', () => {
    expect(shouldShowChannelsTab({ ...base, hasGroupChannels: false })).toBe(false);
  });
  it('visible for members even without pointer (invite-first join)', () => {
    expect(shouldShowChannelsTab({ ...base, isMember: true })).toBe(true);
  });
  it('visible when pointer exists (non-member sees invite inbox)', () => {
    expect(shouldShowChannelsTab({ ...base, pointer: { communityId: 'x' } })).toBe(true);
  });
  // The founding affordance moved to the settings type card ("Privaten
  // Bereich erstellen/verknüpfen") — before any type decision (no pointers
  // at all) nobody sees a channels tab, the owner included: "+ Neuer Kanal"
  // must not found an E2E area as a side effect (laoc, 2026-08-18: the
  // Edufeed community). Owner status is no longer an input here at all.
  it('hidden before the type decision — founding lives in settings now', () => {
    expect(shouldShowChannelsTab({ ...base })).toBe(false);
  });
  // A moderated community (membership pointer) opens the view independent of
  // the Concord flag — this is NIP-29 territory. The owner's "+ Neuer Kanal"
  // path (laoc, 2026-08-18) rides on the same clause.
  it('visible for a moderated community with zero channels, flag off', () => {
    expect(shouldShowChannelsTab({ ...base, enabled: false, hasMembershipPointer: true })).toBe(
      true
    );
  });
  // Since the root membership group doubles as the "General" channel, a
  // moderated community is never channel-less — and subtree channels are
  // pointer-free, so hasGroupChannels can no longer vouch for them. The
  // membership pointer alone must open the view for EVERYONE, or members
  // see channels listed in the Kanäle zone but every click bounces to home
  // (laoc, 2026-08-21: only the key-holder could enter any channel).
  it('visible for a member (non-owner) of a moderated community', () => {
    expect(
      shouldShowChannelsTab({ ...base, enabled: false, isMember: true, hasMembershipPointer: true })
    ).toBe(true);
  });
  it('visible for an anonymous visitor of a moderated community', () => {
    expect(shouldShowChannelsTab({ ...base, enabled: false, hasMembershipPointer: true })).toBe(
      true
    );
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

  // Track the source-of-truth preset bitmasks (roles.js) so this fixture can't
  // drift from the real presets (it did when MOD_PERMS gained MANAGE_CHANNELS).
  const ADMIN_PERMS_STR = ADMIN_PERMS.toString();
  const MOD_PERMS_STR = MOD_PERMS.toString();

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
