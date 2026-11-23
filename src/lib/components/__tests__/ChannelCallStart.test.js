/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  user: /** @type {any} */ ({ pubkey: 'a'.repeat(64), signer: {} }),
  order: /** @type {string[]} */ ([]),
  join: /** @type {any} */ (null)
}));
h.join = vi.fn(async () => {
  h.order.push('join');
});
vi.mock('$lib/groups/group-call.svelte.js', () => ({
  joinGroupCallWithConfirm: (/** @type {any[]} */ ...a) => h.join(...a)
}));
const enable = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/groups/enable-group-calls.js', () => ({ enableGroupCalls: enable }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast', () => ({ showToast: toast }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => h.user }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_start: () => 'Anruf starten',
  groups_call_start_error: () => 'Anrufe konnten nicht eingeschaltet werden.',
  groups_call_start_in: (/** @type {any} */ { name }) => `Anruf in ${name} starten`
}));

import ChannelCallStart from '$lib/components/groups/call/ChannelCallStart.svelte';

const pointer = { id: 'chan', relay: 'wss://groups.example/' };

beforeEach(() => {
  h.user = { pubkey: 'a'.repeat(64), signer: {} };
  h.order = [];
  h.join.mockClear();
  enable.mockReset();
  toast.mockClear();
});

describe('ChannelCallStart', () => {
  it('opens the channel first, then asks to join its call', async () => {
    const onOpen = vi.fn(async () => {
      h.order.push('open');
    });
    const { getByTestId } = render(ChannelCallStart, { props: { pointer, name: 'dev', onOpen } });
    const button = getByTestId('channel-call-start');
    expect(button.getAttribute('aria-label')).toBe('Anruf in dev starten');
    await fireEvent.click(button);
    await Promise.resolve();
    expect(h.order).toEqual(['open', 'join']);
    expect(h.join.mock.calls[0][0]).toEqual(pointer);
    expect(h.join.mock.calls[0][2].title).toBe('dev');
  });

  it('with enableFirst, switches calls on before opening and joining; never without it', async () => {
    enable.mockImplementation(async () => {
      h.order.push('enable');
    });
    const onOpen = vi.fn(async () => {
      h.order.push('open');
    });
    const { getByTestId } = render(ChannelCallStart, {
      props: { pointer, name: 'dev', onOpen, enableFirst: true }
    });
    await fireEvent.click(getByTestId('channel-call-start'));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.order).toEqual(['enable', 'open', 'join']);
  });

  it('stops with a message when calls cannot be switched on', async () => {
    enable.mockRejectedValue(new Error('not an admin'));
    const onOpen = vi.fn();
    const { getByTestId } = render(ChannelCallStart, {
      props: { pointer, name: 'dev', onOpen, enableFirst: true }
    });
    await fireEvent.click(getByTestId('channel-call-start'));
    await Promise.resolve();
    await Promise.resolve();
    expect(onOpen).not.toHaveBeenCalled();
    expect(h.join).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Anrufe konnten nicht eingeschaltet werden.', 'error');
  });

  it('is not there for someone who cannot sign', () => {
    h.user = null;
    const { queryByTestId } = render(ChannelCallStart, {
      props: { pointer, name: 'dev', onOpen: vi.fn() }
    });
    expect(queryByTestId('channel-call-start')).toBeNull();
  });
});
