// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const state = {
  callChat: [{ id: 'a:1', identity: 'b'.repeat(64) + ':1', text: 'Hallo zusammen', at: 1 }],
  canSignal: true
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
});
