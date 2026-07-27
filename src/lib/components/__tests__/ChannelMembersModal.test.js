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
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { BehaviorSubject, of } from 'rxjs';

const OWNER = 'o'.repeat(64);
const ADMIN = 'a'.repeat(64);
const LURKER = 'l'.repeat(64); // community member, never posted in this channel
const ACTIVE = OWNER; // active user is the owner for these tests

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ACTIVE })
}));

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

import ChannelMembersModal from '$lib/components/community/channels/ChannelMembersModal.svelte';
import { kickFromChannel } from '$lib/concord/moderation.js';

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
      props: { community, channel: CHANNEL, isOwner: true, signerHasNip44: true, onClose: () => {} }
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
