/** @vitest-environment jsdom */
/**
 * ChannelMembersModal — community-wide roster + roles rework (Armada-parity
 * follow-up). The CRITICAL invariant under test: the modal DISPLAYS
 * community.members$ (community-wide), but kick/ban must still receive the
 * CHANNEL-scoped keep-list from channelMemberList — never the wider roster —
 * see the component's header comment and moderation.js's rotateChannel
 * trail for why widening it would fan out a fresh channel key to the whole
 * community.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { BehaviorSubject, of } from 'rxjs';

const OWNER = 'o'.repeat(64);
const ADMIN = 'a'.repeat(64);
const ADMIN2 = 'b'.repeat(64); // second admin, used as an "outranks-me" target
const MODERATOR = 'm'.repeat(64);
const MODERATOR2 = 'n'.repeat(64); // second moderator, used as a peer-outranks-me target
const LURKER = 'l'.repeat(64); // community member, never posted in this channel

// Mutable so individual tests can act as a non-owner (e.g. a moderator) —
// defaults to OWNER, reset after each test.
let activeUser = OWNER;

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: activeUser })
}));

afterEach(() => {
  activeUser = OWNER;
});

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: (/** @type {() => Iterable<string>} */ getPubkeys) => () => {
    const map = new Map();
    for (const pubkey of getPubkeys()) map.set(pubkey, { name: 'Name-' + pubkey.slice(0, 4) });
    return map;
  }
}));

vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

vi.mock('$lib/concord/moderation.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/concord/moderation.js'));
  return {
    ...actual,
    kickFromChannel: vi.fn().mockResolvedValue(undefined),
    banFromChannel: vi.fn().mockResolvedValue(undefined)
  };
});

vi.mock('$lib/concord/roles.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/concord/roles.js'));
  return {
    ...actual,
    assignTier: vi.fn().mockResolvedValue(undefined),
    removeTier: vi.fn().mockResolvedValue(undefined)
  };
});

import ChannelMembersModal from '$lib/components/community/channels/ChannelMembersModal.svelte';
import { kickFromChannel } from '$lib/concord/moderation.js';
import { assignTier, removeTier, ADMIN_PERMS, MOD_PERMS } from '$lib/concord/roles.js';

/**
 * Build a fake ConcordCommunity exposing just what the modal reads:
 * members$/roles$/grants$/banlist$, material.owner, channelStore(...).timeline(...),
 * and rotateChannel/ban (mocked via moderation.js above, but the community
 * object itself still needs the methods present so the mocked module calls
 * "work" against something call-shaped).
 * @param {{ members: string[], roles?: any[], grants?: Map<string,string[]>, observedInChannel?: string[] }} opts
 */
function fakeCommunity({ members, roles = [], grants = new Map(), observedInChannel = [] }) {
  return {
    material: { owner: OWNER },
    members$: new BehaviorSubject(new Set(members)),
    roles$: new BehaviorSubject(roles),
    grants$: new BehaviorSubject(grants),
    banlist$: new BehaviorSubject(new Set()),
    channelStore: () => ({
      timeline: () => of(observedInChannel.map((pubkey) => ({ pubkey })))
    }),
    rotateChannel: vi.fn().mockResolvedValue(undefined),
    ban: vi.fn().mockResolvedValue(undefined)
  };
}

const CHANNEL = { channel_id: 'chan-1', name: 'general' };

describe('ChannelMembersModal — community-wide roster', () => {
  it('renders every community member, not just ones observed in this channel', () => {
    // ADMIN and LURKER are both community members; only ADMIN ever posted
    // in this channel (observedInChannel) — the OLD behavior would have
    // hidden LURKER entirely.
    const community = fakeCommunity({
      members: [OWNER, ADMIN, LURKER],
      roles: [{ role_id: 'r1', name: 'Admin', position: 1 }],
      grants: new Map([[ADMIN, ['r1']]]),
      observedInChannel: [ADMIN]
    });

    render(ChannelMembersModal, {
      props: { community, channel: CHANNEL, isOwner: true, signerHasNip44: true, onClose: () => {} }
    });

    expect(screen.getByText('Name-' + LURKER.slice(0, 4))).toBeTruthy();
    expect(screen.getByText('Name-' + ADMIN.slice(0, 4))).toBeTruthy();
  });

  it('shows a role chip for a role-holder and the owner chip for the owner', () => {
    const community = fakeCommunity({
      members: [OWNER, ADMIN],
      roles: [{ role_id: 'r1', name: 'Admin', position: 1 }],
      grants: new Map([[ADMIN, ['r1']]])
    });

    render(ChannelMembersModal, {
      props: { community, channel: CHANNEL, isOwner: true, signerHasNip44: true, onClose: () => {} }
    });

    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('CRITICAL: ban still passes the channel-scoped keep-list, not the community-wide roster', async () => {
    // LURKER is a community member but never posted in this channel, so
    // channelMemberList's approximation excludes them from the keep-list —
    // banning ADMIN must rotate keeping only [OWNER] (self, unioned by the
    // dist regardless), never LURKER.
    const community = fakeCommunity({
      members: [OWNER, ADMIN, LURKER],
      observedInChannel: [ADMIN] // OWNER is unioned in as `self`; LURKER never posted
    });

    render(ChannelMembersModal, {
      props: {
        community,
        channel: CHANNEL,
        isOwner: true,
        canModerate: true,
        myTier: 'owner',
        signerHasNip44: true,
        onClose: () => {}
      }
    });

    const banButtons = screen.getAllByTestId('concord-member-ban');
    await fireEvent.click(banButtons[0]);
    const confirmButton = screen.getByTestId('concord-confirm-action');
    await fireEvent.click(confirmButton);

    expect(kickFromChannel).not.toHaveBeenCalled();
    // Only OWNER/ADMIN were ever channel-observed (+self); LURKER must never
    // appear in the keep-list passed to the moderation call.
    const { banFromChannel } = await import('$lib/concord/moderation.js');
    expect(banFromChannel).toHaveBeenCalled();
    const keepListArg = /** @type {any} */ (banFromChannel).mock.calls[0][3];
    expect(keepListArg).not.toContain(LURKER);
  });
});

// Preset roles as recognized by roles.js's real memberTier() — permissions
// must equal the frozen ADMIN_PERMS/MOD_PERMS bitmask exactly (as decimal
// strings, matching the `permissions:string` shape) or memberTier falls back
// to null, same as a custom/non-preset role.
const ADMIN_ROLE = {
  role_id: 'r-admin',
  name: 'Admin',
  position: 1,
  permissions: String(ADMIN_PERMS)
};
const MOD_ROLE = {
  role_id: 'r-mod',
  name: 'Moderator',
  position: 2,
  permissions: String(MOD_PERMS)
};

function fakeRoledCommunity() {
  return fakeCommunity({
    members: [OWNER, ADMIN, ADMIN2, MODERATOR, LURKER],
    roles: [ADMIN_ROLE, MOD_ROLE],
    grants: new Map([
      [ADMIN, ['r-admin']],
      [ADMIN2, ['r-admin']],
      [MODERATOR, ['r-mod']]
    ])
  });
}

describe('ChannelMembersModal — role actions (capability-gated)', () => {
  it('owner actor: sees make-admin + make-moderator on a roleless member; make-admin assigns the admin tier', async () => {
    const community = fakeRoledCommunity();
    render(ChannelMembersModal, {
      props: {
        community,
        channel: CHANNEL,
        isOwner: true,
        signerHasNip44: true,
        canModerate: true,
        canManageRoles: true,
        canPromoteAdmin: true,
        myTier: 'owner',
        onClose: () => {}
      }
    });

    expect(screen.getByTestId(`concord-make-admin-${LURKER}`)).toBeTruthy();
    expect(screen.getByTestId(`concord-make-moderator-${LURKER}`)).toBeTruthy();

    await fireEvent.click(screen.getByTestId(`concord-make-admin-${LURKER}`));
    await fireEvent.click(screen.getByTestId('concord-confirm-action'));

    expect(assignTier).toHaveBeenCalledWith(community, LURKER, 'admin');
  });

  it('admin actor (canPromoteAdmin=false): sees make-moderator but not make-admin; can demote a moderator; no role actions on another admin/owner row', async () => {
    const community = fakeRoledCommunity();
    render(ChannelMembersModal, {
      props: {
        community,
        channel: CHANNEL,
        isOwner: false,
        signerHasNip44: true,
        canModerate: true,
        canManageRoles: true,
        canPromoteAdmin: false,
        myTier: 'admin',
        onClose: () => {}
      }
    });

    // No "make admin" button anywhere in the roster.
    expect(screen.queryByTestId(`concord-make-admin-${LURKER}`)).toBeNull();
    expect(screen.queryByTestId(`concord-make-admin-${MODERATOR}`)).toBeNull();

    // Can offer to promote a roleless member to moderator.
    expect(screen.getByTestId(`concord-make-moderator-${LURKER}`)).toBeTruthy();

    // Can demote the moderator (remove their role) — confirm calls removeTier.
    const removeButton = screen.getByTestId(`concord-remove-role-${MODERATOR}`);
    await fireEvent.click(removeButton);
    await fireEvent.click(screen.getByTestId('concord-confirm-action'));
    expect(removeTier).toHaveBeenCalledWith(community, MODERATOR);

    // No role actions at all on another admin's row (admin can't outrank admin) or the owner's row.
    expect(screen.queryByTestId(`concord-make-moderator-${ADMIN2}`)).toBeNull();
    expect(screen.queryByTestId(`concord-remove-role-${ADMIN2}`)).toBeNull();
    expect(screen.queryByTestId(`concord-remove-role-${OWNER}`)).toBeNull();
    expect(screen.queryByTestId(`concord-make-moderator-${OWNER}`)).toBeNull();
  });

  it('moderator actor (canManageRoles=false): no role actions anywhere', () => {
    const community = fakeRoledCommunity();
    render(ChannelMembersModal, {
      props: {
        community,
        channel: CHANNEL,
        isOwner: false,
        signerHasNip44: true,
        canModerate: true,
        canManageRoles: false,
        canPromoteAdmin: false,
        myTier: 'moderator',
        onClose: () => {}
      }
    });

    for (const target of [OWNER, ADMIN, ADMIN2, MODERATOR, LURKER]) {
      expect(screen.queryByTestId(`concord-make-admin-${target}`)).toBeNull();
      expect(screen.queryByTestId(`concord-make-moderator-${target}`)).toBeNull();
      expect(screen.queryByTestId(`concord-remove-role-${target}`)).toBeNull();
    }
  });

  it('kick/ban show for a non-owner actor when canModerate is true (re-gated from isOwner-only)', () => {
    const community = fakeRoledCommunity();
    render(ChannelMembersModal, {
      props: {
        community,
        channel: CHANNEL,
        isOwner: false,
        signerHasNip44: true,
        canModerate: true,
        canManageRoles: false,
        canPromoteAdmin: false,
        myTier: 'moderator',
        onClose: () => {}
      }
    });

    expect(screen.getAllByTestId('concord-member-ban').length).toBeGreaterThan(0);
  });

  it('kick/ban are hidden for a non-owner actor when canModerate is false', () => {
    const community = fakeRoledCommunity();
    render(ChannelMembersModal, {
      props: {
        community,
        channel: CHANNEL,
        isOwner: false,
        signerHasNip44: true,
        canModerate: false,
        canManageRoles: false,
        canPromoteAdmin: false,
        myTier: null,
        onClose: () => {}
      }
    });

    expect(screen.queryAllByTestId('concord-member-ban').length).toBe(0);
  });

  it('moderator actor: kick/ban outrank-gated per target — present on roleless, absent on owner/admin/peer-moderator', () => {
    // Regression test for the authority-gating bug: kick/ban used to be
    // gated only on `canModerate && !self`, with no per-target outrank
    // check (unlike role actions, which use canActOnTier). A moderator
    // would see kick/ban on EVERY non-self row, including the owner and
    // admins — canModerateTier(myTier, targetTier) must restrict this to
    // roleless targets only for a moderator actor.
    // Active user IS the moderator (not the owner, unlike the other tests
    // in this file) — otherwise the `!self` check alone would hide the
    // owner's own row and the test would pass without exercising
    // canModerateTier at all. MODERATOR2 is a distinct peer moderator (not
    // the actor) so the "moderator can't act on another moderator" branch
    // is genuinely exercised, not just hidden behind the self-check.
    activeUser = MODERATOR;
    const community = fakeCommunity({
      members: [OWNER, ADMIN, MODERATOR, MODERATOR2, LURKER],
      roles: [ADMIN_ROLE, MOD_ROLE],
      grants: new Map([
        [ADMIN, ['r-admin']],
        [MODERATOR, ['r-mod']],
        [MODERATOR2, ['r-mod']]
      ])
    });
    render(ChannelMembersModal, {
      props: {
        community,
        channel: CHANNEL,
        isOwner: false,
        signerHasNip44: true,
        canModerate: true,
        canManageRoles: false,
        canPromoteAdmin: false,
        myTier: 'moderator',
        onClose: () => {}
      }
    });

    // Roleless member (LURKER): kick/ban present.
    const lurkerRow = /** @type {HTMLElement} */ (
      screen.getByText('Name-' + LURKER.slice(0, 4)).closest('div')
    );
    expect(within(lurkerRow).queryByTestId('concord-member-ban')).toBeTruthy();

    // Owner, admin, and peer moderator (MODERATOR2, not self): kick/ban absent.
    for (const target of [OWNER, ADMIN, MODERATOR2]) {
      const row = /** @type {HTMLElement} */ (
        screen.getByText('Name-' + target.slice(0, 4)).closest('div')
      );
      expect(within(row).queryByTestId('concord-member-ban')).toBeNull();
    }
  });
});
