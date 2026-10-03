// @ts-nocheck
/**
 * CallSwitchConfirmModal — "You're in a call in <title>. Switch?" (Task M6).
 * Pure presentation: ModalManager wires onConfirm/onCancel to the Promise
 * held by confirmCallSwitch (group-call.svelte.js); this component just
 * renders the small-modal grammar and calls the callbacks it is given.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  groups_call_switch_confirm_title: () => 'Switch call?',
  groups_call_switch_confirm_body: ({ title }) => `You're in a call in ${title}. Switch?`,
  groups_call_switch_confirm_action: () => 'Switch',
  common_cancel: () => 'Cancel'
}));

import CallSwitchConfirmModal from '../groups/CallSwitchConfirmModal.svelte';

const onConfirm = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  onConfirm.mockClear();
  onCancel.mockClear();
});

describe('CallSwitchConfirmModal', () => {
  it('names the call the user is currently in, under a short heading', () => {
    render(CallSwitchConfirmModal, { props: { title: 'Standup', onConfirm, onCancel } });
    expect(screen.getByText('Switch call?')).toBeTruthy();
    expect(screen.getByTestId('call-switch-confirm').textContent).toContain(
      "You're in a call in Standup. Switch?"
    );
  });

  it('is announced as an alert dialog labelled by its heading', () => {
    render(CallSwitchConfirmModal, { props: { title: 'Standup', onConfirm, onCancel } });
    const dialog = screen.getByTestId('call-switch-confirm');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId).textContent).toBe('Switch call?');
  });

  it('"Switch" (primary) calls onConfirm', async () => {
    render(CallSwitchConfirmModal, { props: { title: 'Standup', onConfirm, onCancel } });
    await fireEvent.click(screen.getByTestId('call-switch-confirm-action'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('"Cancel" (ghost) calls onCancel', async () => {
    render(CallSwitchConfirmModal, { props: { title: 'Standup', onConfirm, onCancel } });
    await fireEvent.click(screen.getByTestId('call-switch-confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('follows the small-modal grammar: ghost cancel + primary action', () => {
    render(CallSwitchConfirmModal, { props: { title: 'Standup', onConfirm, onCancel } });
    const action = screen.getByTestId('call-switch-confirm-action');
    const cancel = screen.getByTestId('call-switch-confirm-cancel');
    expect(action.className).toContain('btn-primary');
    expect(cancel.className).toContain('btn-ghost');
    expect(screen.getByTestId('call-switch-confirm').querySelector('.modal-box')).toBeTruthy();
  });
});
