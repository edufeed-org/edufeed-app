/**
 * @vitest-environment jsdom
 *
 * GroupCreateModal — create a NIP-29 channel directly on a host relay
 * (laoc, 2026-08-11 live test: the relay page had no way to create a room).
 * The relay is fixed by the page; on success the group is mirrored into the
 * personal kind-10009 list and the user is taken into the new channel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const RELAY = 'wss://groups.example/';
const SELF = 'f'.repeat(64);

const createGroupOnRelay = vi.hoisted(() => vi.fn(async () => ({ kind: 39000 })));
const generateGroupId = vi.hoisted(() => vi.fn(() => 'gid123'));
const updatePersonalGroupsList = vi.hoisted(() => vi.fn(async () => {}));
const showToast = vi.hoisted(() => vi.fn());
const goto = vi.hoisted(() => vi.fn());
const relayConn = vi.hoisted(() => ({ marker: 'relay-conn' }));

vi.mock('$lib/groups/group-management.js', () => ({ createGroupOnRelay, generateGroupId }));
vi.mock('$lib/groups/personal-groups-list.js', () => ({ updatePersonalGroupsList }));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relayConn) }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: SELF, signer: { signEvent: vi.fn() } })
}));

import GroupCreateModal from '$lib/components/groups/GroupCreateModal.svelte';

beforeEach(() => {
  createGroupOnRelay.mockClear();
  createGroupOnRelay.mockResolvedValue({ kind: 39000 });
  updatePersonalGroupsList.mockClear();
  showToast.mockClear();
  goto.mockClear();
});

describe('GroupCreateModal', () => {
  it('defaults to private+closed and submit stays disabled without a name', () => {
    render(GroupCreateModal, { props: { relay: RELAY, onClose: vi.fn() } });
    const el = (/** @type {string} */ id) =>
      /** @type {HTMLInputElement} */ (screen.getByTestId(id));
    expect(el('group-create-public').checked).toBe(false);
    expect(el('group-create-open').checked).toBe(false);
    expect(el('group-create-confirm').disabled).toBe(true);
  });

  it('creates on this relay, mirrors into the 10009 list, navigates in', async () => {
    const onClose = vi.fn();
    render(GroupCreateModal, { props: { relay: RELAY, onClose } });
    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Mathe' }
    });
    await fireEvent.click(screen.getByTestId('group-create-confirm'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(createGroupOnRelay).toHaveBeenCalledWith(
      expect.objectContaining({
        relayConn,
        id: 'gid123',
        metadata: expect.objectContaining({ name: 'Mathe', isPublic: false, isOpen: false }),
        user: expect.objectContaining({ pubkey: SELF })
      })
    );
    expect(updatePersonalGroupsList).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: SELF }),
      { add: { id: 'gid123', relay: RELAY } }
    );
    expect(goto).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('gid123')));
    expect(showToast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('keeps the modal open and toasts when the relay refuses', async () => {
    createGroupOnRelay.mockRejectedValueOnce(new Error('restricted: not an admin'));
    const onClose = vi.fn();
    render(GroupCreateModal, { props: { relay: RELAY, onClose } });
    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Mathe' }
    });
    await fireEvent.click(screen.getByTestId('group-create-confirm'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(onClose).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    expect(updatePersonalGroupsList).not.toHaveBeenCalled();
  });
});
