// @ts-nocheck
/**
 * call-switch-confirm.svelte.js — the shared "you're in a call elsewhere.
 * Switch?" confirmation (Task M6). A thin Promise wrapper around the app's
 * modal store: opens the 'callSwitchConfirm' type (rendered by ModalManager
 * via CallSwitchConfirmModal), and resolves once the modal's
 * onConfirm/onCancel callback fires — or false if the modal goes away any
 * OTHER way (a second confirm superseding it, another modal opening on top,
 * or anything calling closeModal() directly), so the Promise is never left
 * dangling (review fix round 1).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import { modalStore } from '$lib/stores/modal.svelte.js';
import {
  confirmCallSwitch,
  confirmCallLeave,
  confirmCallJoin
} from '$lib/groups/call-switch-confirm.svelte.js';

beforeEach(() => {
  modalStore.closeModal();
});

describe('confirmCallSwitch', () => {
  it('opens the shared confirm modal with the current call title', () => {
    confirmCallSwitch('Standup');
    expect(modalStore.activeModal).toBe('callSwitchConfirm');
    expect(modalStore.modalProps).toEqual({ title: 'Standup' });
  });

  it('resolves true and closes the modal when the callback-held onConfirm fires', async () => {
    const pending = confirmCallSwitch('Standup');
    modalStore.modalCallbacks.onConfirm();
    await expect(pending).resolves.toBe(true);
    expect(modalStore.activeModal).toBe('none');
  });

  it('resolves false and closes the modal when onCancel fires', async () => {
    const pending = confirmCallSwitch('Standup');
    modalStore.modalCallbacks.onCancel();
    await expect(pending).resolves.toBe(false);
    expect(modalStore.activeModal).toBe('none');
  });

  // Review fix round 1: a second confirm while one is still pending used to
  // silently overwrite the first one's modalProps/callbacks, orphaning its
  // Promise forever — a caller awaiting it (e.g. ChannelCallRoster's `busy`
  // flag) never recovered.
  it('a second confirm while one is pending cancels the first instead of orphaning it', async () => {
    const first = confirmCallSwitch('Standup');
    const second = confirmCallSwitch('Catchup');

    await expect(first).resolves.toBe(false);
    // The second confirm is the one left live, with its own props/callbacks.
    expect(modalStore.activeModal).toBe('callSwitchConfirm');
    expect(modalStore.modalProps).toEqual({ title: 'Catchup' });

    modalStore.modalCallbacks.onConfirm();
    await expect(second).resolves.toBe(true);
  });

  it('resolves false if another modal opens on top instead of this one closing normally', async () => {
    const pending = confirmCallSwitch('Standup');
    modalStore.openModal('login');
    flushSync();
    await expect(pending).resolves.toBe(false);
  });

  it('resolves false if the modal is closed by any other path (e.g. closeModal() directly)', async () => {
    const pending = confirmCallSwitch('Standup');
    modalStore.closeModal();
    flushSync();
    await expect(pending).resolves.toBe(false);
  });
});

// Task 19: the same modal-store wrapper asks before leaving a call.
describe('confirmCallLeave', () => {
  it('opens the leave confirm, saying whether the user came in through a link', () => {
    confirmCallLeave({ guest: true });
    expect(modalStore.activeModal).toBe('callLeaveConfirm');
    expect(modalStore.modalProps).toEqual({ guest: true });
  });

  it('resolves true on confirm, false on cancel', async () => {
    const yes = confirmCallLeave({ guest: false });
    modalStore.modalCallbacks.onConfirm();
    await expect(yes).resolves.toBe(true);
    const no = confirmCallLeave({ guest: false });
    modalStore.modalCallbacks.onCancel();
    await expect(no).resolves.toBe(false);
    expect(modalStore.activeModal).toBe('none');
  });

  it('resolves false when another modal replaces it', async () => {
    const pending = confirmCallLeave({ guest: false });
    modalStore.openModal('login');
    flushSync();
    await expect(pending).resolves.toBe(false);
  });

  it('an aborted signal dismisses the dialog and resolves false (the call ended)', async () => {
    const moot = new AbortController();
    const pending = confirmCallLeave({ guest: false, signal: moot.signal });
    expect(modalStore.activeModal).toBe('callLeaveConfirm');
    moot.abort();
    flushSync();
    await expect(pending).resolves.toBe(false);
    expect(modalStore.activeModal).toBe('none');
  });

  it('a switch confirm opening on top settles a pending leave confirm as cancelled', async () => {
    const leave = confirmCallLeave({ guest: false });
    confirmCallSwitch('Standup');
    await expect(leave).resolves.toBe(false);
    expect(modalStore.activeModal).toBe('callSwitchConfirm');
  });
});

// The pre-join lobby (issue "pre-join preview"): same modal slot, but the
// answer carries the chosen media instead of a bare yes.
describe('confirmCallJoin', () => {
  it('opens the pre-join modal with the channel title', () => {
    confirmCallJoin('Standup');
    expect(modalStore.activeModal).toBe('callPreJoin');
    expect(modalStore.modalProps).toEqual({ title: 'Standup' });
  });

  it('resolves with the media the lobby confirmed and closes the modal', async () => {
    const pending = confirmCallJoin('Standup');
    modalStore.modalCallbacks.onConfirm({ audio: true, video: false });
    await expect(pending).resolves.toEqual({ audio: true, video: false });
    expect(modalStore.activeModal).toBe('none');
  });

  it('resolves null on cancel and when another modal replaces it', async () => {
    const first = confirmCallJoin('Standup');
    modalStore.modalCallbacks.onCancel();
    await expect(first).resolves.toBeNull();
    const second = confirmCallJoin('Standup');
    modalStore.openModal('login');
    flushSync();
    await expect(second).resolves.toBeNull();
  });
});
