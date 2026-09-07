/** @vitest-environment jsdom */
/**
 * MemberActionsMenu — the per-row NIP-29 roster action kebab extracted from
 * GroupMembersModal so MembersView can offer the same management inline
 * (issue: consolidate Members and Manage Members into one section).
 *
 * Same semantics as the modal rows: put-user REPLACES the whole role set, so
 * promote/demote/toggle-publisher must carry the publisher role across; the
 * two heavyweight actions (assign role, remove) open their own small dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const {
  relaySentinel,
  activeUser,
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  publishToGroupRelay,
  showToast
} = vi.hoisted(() => ({
  relaySentinel: { __sentinel: 'relay-conn' },
  activeUser: { pubkey: 'f'.repeat(64), signer: {} },
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
  publishToGroupRelay: vi.fn(() => Promise.resolve({ id: 'signed' })),
  showToast: vi.fn()
}));

vi.mock('$lib/groups/group-management.js', () => ({
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  publishToGroupRelay
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relaySentinel) }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => activeUser }));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_members_promote: () => 'Make admin',
  groups_members_demote: () => 'Remove admin',
  groups_members_remove: () => 'Remove',
  groups_members_grant_publisher: () => 'Make publisher',
  groups_members_revoke_publisher: () => 'Remove publisher',
  groups_members_assign_role: () => 'Assign role',
  groups_members_assign_role_open: () => 'Assign role …',
  groups_members_assign_role_title: () => 'Assign role',
  groups_members_assign_role_body: (/** @type {{name: string}} */ { name }) =>
    `New role for ${name}.`,
  groups_members_remove_confirm_title: (/** @type {{name: string}} */ { name }) =>
    `Remove ${name}?`,
  groups_members_remove_confirm_body: (/** @type {{name: string}} */ { name }) =>
    `${name} loses access to this group.`,
  groups_members_row_menu: (/** @type {{name: string}} */ { name }) => `Actions for ${name}`,
  groups_members_role_placeholder: () => 'Role',
  groups_members_action_failed: () => 'The relay refused the change',
  common_cancel: () => 'Cancel'
}));

const { default: MemberActionsMenu } = await import(
  '$lib/components/groups/MemberActionsMenu.svelte'
);

const TARGET = 'a'.repeat(64);
const pointer = { id: 'grp1', relay: 'wss://relay.example/' };

/** @param {Record<string, any>} overrides */
function renderMenu(overrides = {}) {
  const onRosterChanged = vi.fn();
  const onMemberAdded = vi.fn();
  const props = {
    pointer,
    pubkey: TARGET,
    name: 'Alice',
    roles: /** @type {string[]} */ ([]),
    actions: { togglePublisher: true, promote: true, remove: true },
    onRosterChanged,
    onMemberAdded,
    ...overrides
  };
  const result = render(MemberActionsMenu, { props });
  return { ...result, onRosterChanged, onMemberAdded };
}

beforeEach(() => {
  buildPutUserTemplate.mockClear();
  buildRemoveUserTemplate.mockClear();
  publishToGroupRelay.mockClear();
  publishToGroupRelay.mockResolvedValue({ id: 'signed' });
  showToast.mockClear();
});

describe('MemberActionsMenu rendering', () => {
  it('renders only the actions the caller enabled', () => {
    renderMenu({ actions: { togglePublisher: true, promote: true, remove: true } });
    expect(screen.getByTestId('member-actions-menu')).toBeTruthy();
    expect(screen.getByTestId('member-toggle-publisher')).toBeTruthy();
    expect(screen.getByTestId('member-promote')).toBeTruthy();
    expect(screen.getByTestId('member-remove')).toBeTruthy();
    expect(screen.queryByTestId('member-demote')).toBeNull();
  });

  it('renders the assign-role action only when roleOptions are supplied', () => {
    const { unmount } = renderMenu({ roleOptions: [] });
    expect(screen.queryByTestId('member-assign-role')).toBeNull();
    unmount();
    renderMenu({ roleOptions: ['admin', 'publisher'] });
    expect(screen.getByTestId('member-assign-role')).toBeTruthy();
  });
});

describe('MemberActionsMenu role-preserving put-user semantics', () => {
  it('promote on a publisher carries the publisher role across', async () => {
    const { onRosterChanged } = renderMenu({
      roles: ['publisher'],
      actions: { promote: true }
    });
    await fireEvent.click(screen.getByTestId('member-promote'));
    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalled());
    expect(buildPutUserTemplate).toHaveBeenCalledWith('grp1', TARGET, ['admin', 'publisher']);
    expect(onRosterChanged).toHaveBeenCalled();
  });

  it('demote strips moderation roles but leaves the publisher role standing', async () => {
    renderMenu({ roles: ['admin', 'publisher'], actions: { demote: true } });
    await fireEvent.click(screen.getByTestId('member-demote'));
    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalled());
    expect(buildPutUserTemplate).toHaveBeenCalledWith('grp1', TARGET, ['publisher']);
  });

  it('toggle-publisher grants [publisher] to a plain member and revokes it keeping other roles', async () => {
    const first = renderMenu({ roles: [], actions: { togglePublisher: true } });
    await fireEvent.click(screen.getByTestId('member-toggle-publisher'));
    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalled());
    expect(buildPutUserTemplate).toHaveBeenCalledWith('grp1', TARGET, ['publisher']);
    first.unmount();

    buildPutUserTemplate.mockClear();
    publishToGroupRelay.mockClear();
    publishToGroupRelay.mockResolvedValue({ id: 'signed' });
    renderMenu({ roles: ['publisher', 'custom-role'], actions: { togglePublisher: true } });
    await fireEvent.click(screen.getByTestId('member-toggle-publisher'));
    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalled());
    expect(buildPutUserTemplate).toHaveBeenCalledWith('grp1', TARGET, ['custom-role']);
  });

  it('a successful put-user also invokes onMemberAdded with the pubkey', async () => {
    const { onMemberAdded } = renderMenu({ actions: { promote: true } });
    await fireEvent.click(screen.getByTestId('member-promote'));
    await waitFor(() => expect(onMemberAdded).toHaveBeenCalledWith(TARGET));
  });
});

describe('MemberActionsMenu dialogs', () => {
  it('remove asks for confirmation first, then publishes remove-user and refreshes', async () => {
    const { onRosterChanged } = renderMenu({ actions: { remove: true } });
    await fireEvent.click(screen.getByTestId('member-remove'));
    expect(publishToGroupRelay).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId('member-remove-confirm'));
    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalled());
    expect(buildRemoveUserTemplate).toHaveBeenCalledWith('grp1', TARGET);
    expect(onRosterChanged).toHaveBeenCalled();
  });

  it('assigning a role through the dialog publishes put-user with exactly that role', async () => {
    renderMenu({ roleOptions: ['admin', 'publisher'], actions: {} });
    await fireEvent.click(screen.getByTestId('member-assign-role'));
    const input = screen.getByTestId('member-role-input');
    await fireEvent.input(input, { target: { value: 'reviewer' } });
    await fireEvent.click(screen.getByTestId('member-assign-role-confirm'));
    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalled());
    expect(buildPutUserTemplate).toHaveBeenCalledWith('grp1', TARGET, ['reviewer']);
  });

  it('the assign-role confirm stays disabled while the input is blank', async () => {
    renderMenu({ roleOptions: ['admin'], actions: {} });
    await fireEvent.click(screen.getByTestId('member-assign-role'));
    const confirm = /** @type {HTMLButtonElement} */ (
      screen.getByTestId('member-assign-role-confirm')
    );
    expect(confirm.disabled).toBe(true);
  });
});

describe('MemberActionsMenu error handling', () => {
  it('a rejected publish shows an error toast and does not refresh the roster', async () => {
    publishToGroupRelay.mockRejectedValueOnce(new Error('nope'));
    const { onRosterChanged } = renderMenu({ actions: { promote: true } });
    await fireEvent.click(screen.getByTestId('member-promote'));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('The relay refused the change', 'error')
    );
    expect(onRosterChanged).not.toHaveBeenCalled();
  });
});
