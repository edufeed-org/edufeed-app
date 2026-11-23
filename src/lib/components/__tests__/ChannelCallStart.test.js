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
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => h.user }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_call_start: () => 'Anruf starten',
  groups_call_start_in: (/** @type {any} */ { name }) => `Anruf in ${name} starten`
}));

import ChannelCallStart from '$lib/components/groups/call/ChannelCallStart.svelte';

const pointer = { id: 'chan', relay: 'wss://groups.example/' };

beforeEach(() => {
  h.user = { pubkey: 'a'.repeat(64), signer: {} };
  h.order = [];
  h.join.mockClear();
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

  it('is not there for someone who cannot sign', () => {
    h.user = null;
    const { queryByTestId } = render(ChannelCallStart, {
      props: { pointer, name: 'dev', onOpen: vi.fn() }
    });
    expect(queryByTestId('channel-call-start')).toBeNull();
  });
});
