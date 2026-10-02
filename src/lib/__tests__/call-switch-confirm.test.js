// @ts-nocheck
/**
 * call-switch-confirm.js — the shared "you're in a call elsewhere. Switch?"
 * confirmation (Task M6). It is a thin Promise wrapper around the app's
 * modal store: opens the 'callSwitchConfirm' type (rendered by
 * ModalManager via CallSwitchConfirmModal), and resolves once the modal's
 * onConfirm/onCancel callback fires.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { modalStore } from '$lib/stores/modal.svelte.js';
import { confirmCallSwitch } from '$lib/groups/call-switch-confirm.js';

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
});
