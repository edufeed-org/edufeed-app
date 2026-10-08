// @ts-nocheck
/**
 * BreakoutAssignmentModal — "Du wurdest „Raum“ zugeteilt": switch now, stay,
 * or be switched when the countdown runs out. Pure presentation; the
 * breakout store does the switching through onConfirm.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';

vi.mock('$lib/paraglide/messages', () => ({
  groups_call_breakout_assigned_title: ({ room }) => `You were assigned to “${room}”`,
  groups_call_breakout_assigned_body: ({ seconds }) => `Switching in ${seconds} s`,
  groups_call_breakout_switch: () => 'Switch',
  groups_call_breakout_stay: () => 'Stay'
}));

import BreakoutAssignmentModal from '../groups/BreakoutAssignmentModal.svelte';

const onConfirm = vi.fn();
const onCancel = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  onConfirm.mockClear();
  onCancel.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('BreakoutAssignmentModal', () => {
  it('names the room and offers switch / stay', async () => {
    render(BreakoutAssignmentModal, {
      props: { roomName: 'Breakout 2 · Seminar', autoMs: 5000, onConfirm, onCancel }
    });
    const dialog = screen.getByTestId('breakout-assignment');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.textContent).toContain('You were assigned to “Breakout 2 · Seminar”');
    expect(screen.getByTestId('breakout-assignment-countdown').textContent).toContain('5 s');
    await fireEvent.click(screen.getByTestId('breakout-assignment-switch'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByTestId('breakout-assignment-stay'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('counts down and confirms by itself at zero', async () => {
    render(BreakoutAssignmentModal, {
      props: { roomName: 'Breakout 1', autoMs: 3000, onConfirm, onCancel }
    });
    await vi.advanceTimersByTimeAsync(1100);
    expect(screen.getByTestId('breakout-assignment-countdown').textContent).toContain('2 s');
    expect(onConfirm).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2100);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('stops the countdown when closed early', async () => {
    const { unmount } = render(BreakoutAssignmentModal, {
      props: { roomName: 'Breakout 1', autoMs: 1000, onConfirm, onCancel }
    });
    unmount();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
