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
const probeRelayAvSupport = vi.hoisted(() => vi.fn(async () => false));
vi.mock('$lib/groups/livekit.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual, probeRelayAvSupport };
});

import GroupCreateModal from '$lib/components/groups/GroupCreateModal.svelte';

beforeEach(() => {
  probeRelayAvSupport.mockReset().mockResolvedValue(false);
  createGroupOnRelay.mockClear();
  createGroupOnRelay.mockResolvedValue({ kind: 39000 });
  updatePersonalGroupsList.mockClear();
  showToast.mockClear();
  goto.mockClear();
});

describe('GroupCreateModal', () => {
  it('defaults to private+closed+listed and submit stays disabled without a name', () => {
    render(GroupCreateModal, { props: { relay: RELAY, onClose: vi.fn() } });
    const el = (/** @type {string} */ id) =>
      /** @type {HTMLInputElement} */ (screen.getByTestId(id));
    expect(el('group-create-public').checked).toBe(false);
    expect(el('group-create-open').checked).toBe(false);
    expect(el('group-create-hidden').checked).toBe(false);
    expect(el('group-create-confirm').disabled).toBe(true);
  });

  it('autofocuses the name field when the modal opens', () => {
    render(GroupCreateModal, { props: { relay: RELAY, onClose: vi.fn() } });
    expect(document.activeElement).toBe(screen.getByTestId('group-create-name'));
  });

  it('explains what a relay channel is — feature notice behind the info link', async () => {
    render(GroupCreateModal, { props: { relay: RELAY, onClose: vi.fn() } });
    expect(screen.queryByTestId('group-explainer')).toBeNull();
    await fireEvent.click(screen.getByTestId('group-explainer-open'));
    expect(screen.getByTestId('group-explainer')).toBeTruthy();
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

  it('creates a listed room by default — isHidden false without the toggle', async () => {
    const onClose = vi.fn();
    render(GroupCreateModal, { props: { relay: RELAY, onClose } });
    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Mathe' }
    });
    await fireEvent.click(screen.getByTestId('group-create-confirm'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(createGroupOnRelay).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ isHidden: false }) })
    );
  });

  it('creates a hidden (unlisted) room when the hidden toggle is on', async () => {
    // Hidden rooms (pyramid fork edufeed-v1.3): the room must be BORN with
    // the `hidden` metadata tag — a later 9002 would briefly leak its name
    // into the relay listing.
    const onClose = vi.fn();
    render(GroupCreateModal, { props: { relay: RELAY, onClose } });
    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Mathe' }
    });
    await fireEvent.click(screen.getByTestId('group-create-hidden'));
    await fireEvent.click(screen.getByTestId('group-create-confirm'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    expect(createGroupOnRelay).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ isHidden: true }) })
    );
  });

  it('offers no live audio/video toggle when the relay probe is not 204, and creates with livekit: false', async () => {
    const onClose = vi.fn();
    render(GroupCreateModal, { props: { relay: RELAY, onClose } });
    await waitFor(() => expect(probeRelayAvSupport).toHaveBeenCalledWith(RELAY));
    expect(screen.queryByTestId('group-create-livekit')).toBeNull();
    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Mathe' }
    });
    await fireEvent.click(screen.getByTestId('group-create-confirm'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createGroupOnRelay).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ livekit: false }) })
    );
  });

  it('creates an AV group (bare livekit tag) when the relay supports it and the toggle is on', async () => {
    probeRelayAvSupport.mockResolvedValue(true);
    const onClose = vi.fn();
    render(GroupCreateModal, { props: { relay: RELAY, onClose } });
    const toggle = /** @type {HTMLInputElement} */ (
      await screen.findByTestId('group-create-livekit')
    );
    expect(toggle.checked).toBe(false);
    await fireEvent.input(screen.getByTestId('group-create-name'), {
      target: { value: 'Standup' }
    });
    await fireEvent.click(toggle);
    await fireEvent.click(screen.getByTestId('group-create-confirm'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createGroupOnRelay).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ livekit: true }) })
    );
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
