// @ts-nocheck
/**
 * CallLeaveConfirmModal — "Anruf verlassen?" before leaving a call (Task 19).
 * Pure presentation: the caller (confirmCallLeave via ModalManager, or the
 * pop-out window mounting it directly) wires onConfirm/onCancel.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  groups_call_leave_confirm_title: () => 'Leave call?',
  groups_call_leave_confirm_body: () => 'You can rejoin at any time.',
  groups_call_leave_confirm_body_guest: () => 'You can rejoin with this link while it is valid.',
  groups_call_leave_confirm_action: () => 'Leave',
  common_cancel: () => 'Cancel'
}));

import CallLeaveConfirmModal from '../groups/CallLeaveConfirmModal.svelte';

const onConfirm = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  onConfirm.mockClear();
  onCancel.mockClear();
});

describe('CallLeaveConfirmModal', () => {
  it('asks, with the member copy by default', () => {
    render(CallLeaveConfirmModal, { props: { onConfirm, onCancel } });
    expect(screen.getByText('Leave call?')).toBeTruthy();
    expect(screen.getByText('You can rejoin at any time.')).toBeTruthy();
  });

  it('tells someone who came through a link that the link brings them back', () => {
    render(CallLeaveConfirmModal, { props: { guest: true, onConfirm, onCancel } });
    expect(screen.getByText('You can rejoin with this link while it is valid.')).toBeTruthy();
    expect(screen.queryByText('You can rejoin at any time.')).toBeNull();
  });

  it('small-modal grammar: alertdialog, ghost cancel + error action', () => {
    render(CallLeaveConfirmModal, { props: { onConfirm, onCancel } });
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.classList.contains('modal-open')).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toContain(
      'Leave call?'
    );
    expect(dialog.querySelector('.modal-box').classList.contains('max-w-sm')).toBe(true);
    const cancel = screen.getByTestId('call-leave-confirm-cancel');
    const action = screen.getByTestId('call-leave-confirm-action');
    expect(cancel.classList.contains('btn-ghost')).toBe(true);
    expect(action.classList.contains('btn-error')).toBe(true);
    expect(action.textContent.trim()).toBe('Leave');
  });

  it('Leave confirms, Cancel cancels', async () => {
    render(CallLeaveConfirmModal, { props: { onConfirm, onCancel } });
    await fireEvent.click(screen.getByTestId('call-leave-confirm-action'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByTestId('call-leave-confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape and the backdrop cancel', async () => {
    render(CallLeaveConfirmModal, { props: { onConfirm, onCancel } });
    await fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByTestId('call-leave-confirm-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('focuses Cancel, so Escape works without reaching for the mouse', () => {
    render(CallLeaveConfirmModal, { props: { onConfirm, onCancel } });
    expect(document.activeElement).toBe(screen.getByTestId('call-leave-confirm-cancel'));
  });
});
