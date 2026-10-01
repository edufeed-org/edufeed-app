// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const state = {
  callChat: [{ id: 'a:1', identity: 'b'.repeat(64) + ':1', text: 'Hallo zusammen', at: 1 }],
  canSignal: true,
  isConnected: true
};
const sendCallChat = vi.fn(async () => {});
vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  getLiveKitState: () => state,
  sendCallChat: (...a) => sendCallChat(...a)
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map([['b'.repeat(64), { name: 'Bea' }]])
}));

const { default: CallChatPanel } = await import('$lib/components/groups/call/CallChatPanel.svelte');
const props = { identityToPubkey: (id) => id.slice(0, 64) };

beforeEach(() => {
  state.canSignal = true;
  state.isConnected = true;
  sendCallChat.mockClear();
});

describe('CallChatPanel', () => {
  it('shows messages with the sender name', () => {
    render(CallChatPanel, { props });
    const msg = screen.getByTestId('call-chat-message');
    expect(msg.textContent).toContain('Bea');
    expect(msg.textContent).toContain('Hallo zusammen');
  });

  it('sends on Enter and clears the input', async () => {
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    await fireEvent.input(input, { target: { value: 'Moin' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat).toHaveBeenCalledWith('Moin');
    expect(input.value).toBe('');
  });

  // The server ended the call (removed / dropped): the messages stay
  // readable, but nothing can be sent into a dead Room.
  it('disables the composer while not connected', async () => {
    state.isConnected = false;
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    expect(input.disabled).toBe(true);
    expect(screen.getByTestId('call-chat-send').disabled).toBe(true);
    expect(screen.getByTestId('call-chat-message')).toBeTruthy();
    await fireEvent.submit(input.closest('form'));
    expect(sendCallChat).not.toHaveBeenCalled();
  });
});
