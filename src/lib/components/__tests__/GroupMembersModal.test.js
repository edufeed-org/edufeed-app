/** @vitest-environment jsdom */
/**
 * GroupMembersModal — Task 7. Lists the 39001 admins (with their protocol
 * role tags) then the 39002 members (minus admin pubkeys), and lets an admin
 * put-user (promote/demote/add) or remove-user via the group relay. No local
 * roster mutation: every action calls onRosterChanged so GroupChat re-requests
 * 39001/39002 from the relay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// vi.mock factories are hoisted above these consts, so everything the mock
// factories close over must be built via vi.hoisted() to avoid a "Cannot
// access before initialization" TDZ error at hoist time.
const {
  ADMIN_SELF,
  ADMIN_OTHER,
  MEMBER_A,
  MEMBER_B,
  COMMUNITY_ID,
  relaySentinel,
  activeUser,
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  buildCreateInviteTemplate,
  generateInviteCode,
  publishToGroupRelay,
  sendWrappedDm,
  fetchRelaySelf,
  showToast
} = vi.hoisted(() => {
  const ADMIN_SELF = 'a'.repeat(64);
  const ADMIN_OTHER = 'b'.repeat(64);
  const MEMBER_A = 'c'.repeat(64);
  const MEMBER_B = 'd'.repeat(64);
  const COMMUNITY_ID = 'e'.repeat(64);
  return {
    ADMIN_SELF,
    ADMIN_OTHER,
    MEMBER_A,
    MEMBER_B,
    COMMUNITY_ID,
    relaySentinel: { __sentinel: 'relay-conn' },
    activeUser: { pubkey: ADMIN_SELF, signer: {} },
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
    buildCreateInviteTemplate: vi.fn((groupId, code) => ({
      __sentinel: 'create-invite',
      groupId,
      code
    })),
    generateInviteCode: vi.fn(() => 'INVITECODE123'),
    publishToGroupRelay: vi.fn(() => Promise.resolve({ id: 'signed' })),
    sendWrappedDm: vi.fn(() => Promise.resolve()),
    fetchRelaySelf: vi.fn(() => Promise.resolve(null)),
    showToast: vi.fn()
  };
});

vi.mock('$lib/groups/group-management.js', () => ({
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  buildCreateInviteTemplate,
  generateInviteCode,
  publishToGroupRelay
}));
vi.mock('$lib/services/wrapped-dm.js', () => ({ sendWrappedDm }));
vi.mock('$lib/groups/relay-self.js', () => ({ fetchRelaySelf }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relaySentinel) }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => activeUser }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
function Stub() {}
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_members_title: () => 'Members',
  groups_members_admins_heading: () => 'Admins',
  groups_members_members_heading: () => 'Members',
  groups_members_add_placeholder: () => 'Add member by name or npub',
  groups_members_add_direct_action: () => 'Add directly',
  groups_members_promote: () => 'Make admin',
  groups_members_demote: () => 'Remove admin',
  groups_members_remove: () => 'Remove',
  groups_members_action_failed: () => 'The relay refused the change',
  groups_members_assign_role: () => 'Assign role',
  groups_members_role_placeholder: () => 'Role',
  groups_role_admin: () => 'Admin',
  groups_role_king: () => 'Founder',
  group_invite_dm_action: () => 'Invite via DM',
  group_invite_dm_npub_placeholder: () => 'Member npub',
  group_invite_dm_invalid_npub: () => 'Invalid npub',
  group_invite_dm_send: () => 'Send invite',
  group_invite_dm_body: (/** @type {{name: string}} */ { name }) =>
    `You're invited to join ${name}.`,
  group_invite_dm_sent: () => 'Invite sent via DM.',
  group_invite_dm_failed: (/** @type {{reason: string}} */ { reason }) => `Invite failed: ${reason}`
}));

const { default: GroupMembersModal } = await import(
  '$lib/components/groups/GroupMembersModal.svelte'
);
const { nip19 } = await import('nostr-tools');

const pointer = { id: 'grp1', relay: 'wss://relay.example/' };
const metadata = { name: 'Bee Chat' };

/** @param {Record<string, any>} overrides */
function renderModal(overrides = {}) {
  const onRosterChanged = vi.fn();
  const onClose = vi.fn();
  const props = {
    pointer,
    metadata,
    communityId: COMMUNITY_ID,
    admins: [
      { pubkey: ADMIN_SELF, roles: [] },
      { pubkey: ADMIN_OTHER, roles: ['admin', 'custom-role'] }
    ],
    members: new Set([ADMIN_SELF, ADMIN_OTHER, MEMBER_A, MEMBER_B]),
    myPubkey: ADMIN_SELF,
    isAdmin: true,
    onRosterChanged,
    onClose,
    ...overrides
  };
  const result = render(GroupMembersModal, { props });
  return { ...result, onRosterChanged, onClose };
}

beforeEach(() => {
  buildPutUserTemplate.mockClear();
  buildRemoveUserTemplate.mockClear();
  buildCreateInviteTemplate.mockClear();
  generateInviteCode.mockClear();
  generateInviteCode.mockReturnValue('INVITECODE123');
  publishToGroupRelay.mockClear();
  publishToGroupRelay.mockResolvedValue({ id: 'signed' });
  sendWrappedDm.mockClear();
  sendWrappedDm.mockResolvedValue(undefined);
  fetchRelaySelf.mockClear();
  fetchRelaySelf.mockResolvedValue(null);
  showToast.mockClear();
});

describe('GroupMembersModal rendering', () => {
  it('renders admins with role chips and members without admin duplicates', () => {
    const { container } = renderModal();

    const adminRows = screen.getAllByTestId('admin-row');
    expect(adminRows).toHaveLength(2);
    const memberRows = screen.getAllByTestId('member-row');
    expect(memberRows).toHaveLength(2);
    expect(memberRows.map((row) => row.dataset.pubkey)).toEqual([MEMBER_A, MEMBER_B]);

    // Fallback chip when roles is empty.
    const selfRow = container.querySelector(
      `[data-testid="admin-row"][data-pubkey="${ADMIN_SELF}"]`
    );
    expect(selfRow?.textContent).toContain('Admin');

    // Well-known role tokens get a display label; custom roles pass through
    // verbatim (role-labels.js).
    const otherRow = container.querySelector(
      `[data-testid="admin-row"][data-pubkey="${ADMIN_OTHER}"]`
    );
    expect(otherRow?.textContent).toContain('Admin');
    expect(otherRow?.textContent).toContain('custom-role');
  });

  it('a malformed 39001 with a duplicated role renders one chip, not a crash', () => {
    // Role strings come straight off the group relay's tags — untrusted
    // network input. A relay repeating a role tag must not crash the whole
    // page via each_key_duplicate.
    const { container } = renderModal({
      admins: [
        { pubkey: ADMIN_SELF, roles: [] },
        { pubkey: ADMIN_OTHER, roles: ['admin', 'admin', 'custom-role'] }
      ]
    });

    const otherRow = /** @type {HTMLElement} */ (
      container.querySelector(`[data-testid="admin-row"][data-pubkey="${ADMIN_OTHER}"]`)
    );
    const chips = Array.from(otherRow.querySelectorAll('.badge')).map((el) =>
      el.textContent?.trim()
    );
    expect(chips.filter((text) => text === 'Admin')).toHaveLength(1);
    expect(chips).toContain('custom-role');
  });

  it('non-admin: no action buttons and no add-member input', () => {
    renderModal({ isAdmin: false, myPubkey: MEMBER_A });

    expect(screen.queryAllByTestId('member-promote')).toHaveLength(0);
    expect(screen.queryAllByTestId('member-remove')).toHaveLength(0);
    expect(screen.queryAllByTestId('member-demote')).toHaveLength(0);
    expect(screen.queryByTestId('stub-select-a')).toBeNull();
  });
});

describe('GroupMembersModal admin actions', () => {
  // MembershipPane hangs the members-tier channel fan-out on this hook — it
  // must fire after every successful putUser, with that pubkey. Driven via
  // promote here because it shares the exact putUser pipeline with add.
  it('a successful put-user invokes onMemberAdded with the pubkey', async () => {
    const onMemberAdded = vi.fn();
    const { container } = renderModal({ onMemberAdded });
    const promoteBtn = container.querySelector(
      `[data-testid="member-promote"][data-pubkey="${MEMBER_A}"]`
    );
    await fireEvent.click(/** @type {Element} */ (promoteBtn));
    await waitFor(() => expect(onMemberAdded).toHaveBeenCalledWith(MEMBER_A));
  });

  it('promote publishes put-user with [admin] and refreshes the roster', async () => {
    const { container, onRosterChanged } = renderModal();

    const promoteBtn = container.querySelector(
      `[data-testid="member-promote"][data-pubkey="${MEMBER_A}"]`
    );
    await fireEvent.click(/** @type {Element} */ (promoteBtn));

    await waitFor(() =>
      expect(buildPutUserTemplate).toHaveBeenCalledWith('grp1', MEMBER_A, ['admin'])
    );
    await waitFor(() =>
      expect(publishToGroupRelay).toHaveBeenCalledWith(
        relaySentinel,
        expect.objectContaining({
          __sentinel: 'put',
          groupId: 'grp1',
          pubkey: MEMBER_A,
          roles: ['admin']
        }),
        activeUser
      )
    );
    await waitFor(() => expect(onRosterChanged).toHaveBeenCalled());
  });

  it('demote publishes put-user with [] and refreshes the roster; own admin row has no demote button', async () => {
    const { container, onRosterChanged } = renderModal();

    // Own row never offers demote.
    expect(
      container.querySelector(`[data-testid="member-demote"][data-pubkey="${ADMIN_SELF}"]`)
    ).toBeNull();

    const demoteBtn = container.querySelector(
      `[data-testid="member-demote"][data-pubkey="${ADMIN_OTHER}"]`
    );
    expect(demoteBtn).not.toBeNull();
    await fireEvent.click(/** @type {Element} */ (demoteBtn));

    await waitFor(() => expect(buildPutUserTemplate).toHaveBeenCalledWith('grp1', ADMIN_OTHER, []));
    await waitFor(() =>
      expect(publishToGroupRelay).toHaveBeenCalledWith(
        relaySentinel,
        expect.objectContaining({
          __sentinel: 'put',
          groupId: 'grp1',
          pubkey: ADMIN_OTHER,
          roles: []
        }),
        activeUser
      )
    );
    await waitFor(() => expect(onRosterChanged).toHaveBeenCalled());
  });

  it('remove publishes remove-user and refreshes the roster', async () => {
    const { container, onRosterChanged } = renderModal();

    const removeBtn = container.querySelector(
      `[data-testid="member-remove"][data-pubkey="${MEMBER_B}"]`
    );
    await fireEvent.click(/** @type {Element} */ (removeBtn));

    await waitFor(() => expect(buildRemoveUserTemplate).toHaveBeenCalledWith('grp1', MEMBER_B));
    await waitFor(() =>
      expect(publishToGroupRelay).toHaveBeenCalledWith(
        relaySentinel,
        expect.objectContaining({ __sentinel: 'remove', groupId: 'grp1', pubkey: MEMBER_B }),
        activeUser
      )
    );
    await waitFor(() => expect(onRosterChanged).toHaveBeenCalled());
  });
});

describe('GroupMembersModal role assignment (roleOptions)', () => {
  it('roleOptions omitted: no assign-role control on any row (previous suite unaffected)', () => {
    const { container } = renderModal();
    expect(container.querySelector('[data-testid="member-role-input"]')).toBeNull();
    expect(container.querySelector('[data-testid="member-assign-role"]')).toBeNull();
  });

  it('non-empty roleOptions: an admin sees the assign control on member and admin rows', () => {
    const { container } = renderModal({ roleOptions: ['lehrkraft', 'admin'] });
    expect(
      container.querySelector(`[data-testid="member-role-input"][data-pubkey="${MEMBER_A}"]`)
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-testid="member-assign-role"][data-pubkey="${MEMBER_A}"]`)
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-testid="member-role-input"][data-pubkey="${ADMIN_OTHER}"]`)
    ).not.toBeNull();
  });

  it('own admin row has no assign control (self-lockout guard); another admin row still does', () => {
    const { container } = renderModal({ roleOptions: ['lehrkraft', 'admin'] });
    // NIP-29 put-user REPLACES roles — a self-assign here would drop the
    // active user's own admin capability irrecoverably if they picked a
    // non-admin role while being the sole admin. Mirror the demote guard.
    expect(
      container.querySelector(`[data-testid="member-role-input"][data-pubkey="${ADMIN_SELF}"]`)
    ).toBeNull();
    expect(
      container.querySelector(`[data-testid="member-assign-role"][data-pubkey="${ADMIN_SELF}"]`)
    ).toBeNull();
    expect(
      container.querySelector(`[data-testid="member-role-input"][data-pubkey="${ADMIN_OTHER}"]`)
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-testid="member-assign-role"][data-pubkey="${ADMIN_OTHER}"]`)
    ).not.toBeNull();
  });

  it('non-admin: assign-role control never renders even with roleOptions set', () => {
    const { container } = renderModal({
      roleOptions: ['lehrkraft'],
      isAdmin: false,
      myPubkey: MEMBER_A
    });
    expect(container.querySelector('[data-testid="member-role-input"]')).toBeNull();
    expect(container.querySelector('[data-testid="member-assign-role"]')).toBeNull();
  });

  it('assigning a role publishes put-user with [role] and refreshes the roster', async () => {
    const { container, onRosterChanged } = renderModal({ roleOptions: ['lehrkraft', 'admin'] });

    const input = /** @type {HTMLInputElement} */ (
      container.querySelector(`[data-testid="member-role-input"][data-pubkey="${MEMBER_A}"]`)
    );
    await fireEvent.input(input, { target: { value: 'lehrkraft' } });

    const assignBtn = container.querySelector(
      `[data-testid="member-assign-role"][data-pubkey="${MEMBER_A}"]`
    );
    await fireEvent.click(/** @type {Element} */ (assignBtn));

    await waitFor(() =>
      expect(buildPutUserTemplate).toHaveBeenCalledWith('grp1', MEMBER_A, ['lehrkraft'])
    );
    await waitFor(() =>
      expect(publishToGroupRelay).toHaveBeenCalledWith(
        relaySentinel,
        expect.objectContaining({
          __sentinel: 'put',
          groupId: 'grp1',
          pubkey: MEMBER_A,
          roles: ['lehrkraft']
        }),
        activeUser
      )
    );
    await waitFor(() => expect(onRosterChanged).toHaveBeenCalled());
  });

  it('assign button is disabled while the role input is blank', () => {
    const { container } = renderModal({ roleOptions: ['lehrkraft'] });
    const assignBtn = /** @type {HTMLButtonElement} */ (
      container.querySelector(`[data-testid="member-assign-role"][data-pubkey="${MEMBER_A}"]`)
    );
    expect(assignBtn.disabled).toBe(true);
  });
});

describe('GroupMembersModal error handling', () => {
  it('a rejected publish shows an error toast and does not refresh the roster', async () => {
    publishToGroupRelay.mockRejectedValueOnce(new Error('relay says no'));
    const { container, onRosterChanged } = renderModal();

    const removeBtn = container.querySelector(
      `[data-testid="member-remove"][data-pubkey="${MEMBER_A}"]`
    );
    await fireEvent.click(/** @type {Element} */ (removeBtn));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('The relay refused the change', 'error')
    );
    expect(onRosterChanged).not.toHaveBeenCalled();
  });
});

describe('GroupMembersModal — invite an npub via DM (Task A6)', () => {
  const RECIPIENT_HEX = 'f'.repeat(64);
  const RECIPIENT_NPUB = nip19.npubEncode(RECIPIENT_HEX);

  it('direct-add is the default mode; the DM pane is hidden until toggled', () => {
    renderModal();
    expect(screen.getByTestId('add-mode-direct')).toBeTruthy();
    expect(screen.getByTestId('add-mode-dm')).toBeTruthy();
    expect(screen.queryByTestId('dm-invite-npub-input')).toBeNull();
  });

  it('an invalid npub shows an inline error and publishes/sends nothing', async () => {
    renderModal();

    await fireEvent.click(screen.getByTestId('add-mode-dm'));
    const input = screen.getByTestId('dm-invite-npub-input');
    await fireEvent.input(input, { target: { value: 'not-an-npub' } });
    await fireEvent.click(screen.getByTestId('dm-invite-send'));

    await waitFor(() =>
      expect(screen.getByTestId('dm-invite-error').textContent).toBe('Invalid npub')
    );
    expect(buildCreateInviteTemplate).not.toHaveBeenCalled();
    expect(publishToGroupRelay).not.toHaveBeenCalled();
    expect(sendWrappedDm).not.toHaveBeenCalled();
  });

  it('a valid npub mints a fresh invite code on the group relay and DMs the recipient the code', async () => {
    renderModal();

    await fireEvent.click(screen.getByTestId('add-mode-dm'));
    const input = screen.getByTestId('dm-invite-npub-input');
    await fireEvent.input(input, { target: { value: RECIPIENT_NPUB } });
    await fireEvent.click(screen.getByTestId('dm-invite-send'));

    await waitFor(() => expect(generateInviteCode).toHaveBeenCalled());
    await waitFor(() =>
      expect(buildCreateInviteTemplate).toHaveBeenCalledWith('grp1', 'INVITECODE123')
    );
    await waitFor(() =>
      expect(publishToGroupRelay).toHaveBeenCalledWith(
        relaySentinel,
        expect.objectContaining({
          __sentinel: 'create-invite',
          groupId: 'grp1',
          code: 'INVITECODE123'
        }),
        activeUser
      )
    );
    await waitFor(() => expect(sendWrappedDm).toHaveBeenCalled());
    const [recipients, message] = /** @type {any[]} */ (sendWrappedDm.mock.calls[0]);
    expect(recipients).toEqual([RECIPIENT_HEX]);
    expect(message).toContain('INVITECODE123');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Invite sent via DM.', 'success'));
  });

  it('a failing publish/send toasts the reason and does not send a DM', async () => {
    publishToGroupRelay.mockRejectedValueOnce(new Error('relay says no'));
    renderModal();

    await fireEvent.click(screen.getByTestId('add-mode-dm'));
    const input = screen.getByTestId('dm-invite-npub-input');
    await fireEvent.input(input, { target: { value: RECIPIENT_NPUB } });
    await fireEvent.click(screen.getByTestId('dm-invite-send'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Invite failed: relay says no', 'error')
    );
    expect(sendWrappedDm).not.toHaveBeenCalled();
  });
});
