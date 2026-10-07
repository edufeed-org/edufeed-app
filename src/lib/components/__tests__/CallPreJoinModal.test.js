// @ts-nocheck
/**
 * CallPreJoinModal — the member's lobby before a channel call (modal type
 * 'callPreJoin', asked by confirmCallJoin). The lobby body is lazy; Escape
 * and the backdrop cancel; the lobby's join hands its media to onConfirm.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock(
  '$lib/components/groups/call/CallPreJoin.svelte',
  () => import('./fixtures/CallPreJoinStub.svelte')
);
const m = await import('$lib/paraglide/messages');
const { default: CallPreJoinModal } = await import(
  '$lib/components/groups/CallPreJoinModal.svelte'
);

describe('CallPreJoinModal', () => {
  it('names the channel and forwards the lobby media to onConfirm', async () => {
    const onConfirm = vi.fn();
    render(CallPreJoinModal, { props: { title: 'Standup', onConfirm, onCancel: vi.fn() } });
    expect(screen.getByText(m.groups_call_prejoin_title())).toBeTruthy();
    expect(screen.getByText(m.groups_call_prejoin_hint_titled({ title: 'Standup' }))).toBeTruthy();
    await fireEvent.click(await screen.findByTestId('call-prejoin-join'));
    expect(onConfirm).toHaveBeenCalledWith({ audio: true, video: false });
  });

  it('Escape, the backdrop and the lobby cancel all cancel', async () => {
    const onCancel = vi.fn();
    render(CallPreJoinModal, { props: { title: '', onConfirm: vi.fn(), onCancel } });
    await screen.findByTestId('call-prejoin-stub');
    await fireEvent.keyDown(screen.getByTestId('call-prejoin-modal'), { key: 'Escape' });
    await fireEvent.click(screen.getByTestId('call-prejoin-backdrop'));
    await fireEvent.click(screen.getByTestId('call-prejoin-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(3);
  });
});
