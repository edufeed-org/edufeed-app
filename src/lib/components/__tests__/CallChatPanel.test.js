// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// Polyfill Element.animate for jsdom (HoverCard's popup uses a fade transition).
// Same shim as HoverCard.test.js — completes instantly so it never blocks the DOM.
if (!Element.prototype.animate) {
  Element.prototype.animate = function (_keyframes, _options) {
    const finishedPromise = Promise.resolve();
    const anim = {
      onfinish: /** @type {(() => void) | null} */ (null),
      cancel: vi.fn(),
      finished: finishedPromise,
      currentTime: /** @type {number | null} */ (null),
      playState: 'finished'
    };
    finishedPromise.then(() => {
      if (anim.onfinish) anim.onfinish();
    });
    return anim;
  };
}

const DEFAULT_CHAT = [
  { id: 'a:1', identity: 'b'.repeat(64) + ':1', text: 'Hallo zusammen', at: 1 }
];
const state = {
  callChat: DEFAULT_CHAT,
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
vi.mock(
  '$lib/components/shared/ProfileAvatar.svelte',
  () => import('./fixtures/ProfileAvatarStub.svelte')
);
vi.mock(
  '$lib/components/shared/ProfileHoverCardContent.svelte',
  () => import('./fixtures/ProfileHoverCardContentStub.svelte')
);
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));
const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (/** @type {any} */ href) => gotoMock(href) }));
// Pop-out (Document PiP) is a seam, same convention as GroupChat.test.js.
const popout = vi.hoisted(() => ({
  supported: false,
  popOutCall: vi.fn(async (/** @type {any} */ _view) => {})
}));
vi.mock('$lib/groups/call-popout.svelte.js', () => ({
  canPopOutCall: () => popout.supported,
  popOutCall: (/** @type {any} */ view) => popout.popOutCall(view)
}));

const m = await import('$lib/paraglide/messages');
const { profileLink } = await import('$lib/helpers/nostrUtils.js');
const { default: CallChatPanel } = await import('$lib/components/groups/call/CallChatPanel.svelte');
const props = { identityToPubkey: (id) => id.slice(0, 64), title: 'arbeitszimmer' };

beforeEach(() => {
  state.callChat = DEFAULT_CHAT;
  state.canSignal = true;
  state.isConnected = true;
  sendCallChat.mockClear();
  gotoMock.mockClear();
  popout.supported = false;
  popout.popOutCall.mockClear();
});

describe('CallChatPanel', () => {
  it('shows messages with the sender name', () => {
    render(CallChatPanel, { props });
    const msg = screen.getByTestId('call-chat-message');
    expect(msg.textContent).toContain('Bea');
    expect(msg.textContent).toContain('Hallo zusammen');
  });

  // Task 18: small avatar before the name — reuses ProfileAvatar (profile
  // picture, or its own initial fallback) for any resolved pubkey, member or
  // guest alike (guests get a real generated keypair too).
  it('shows a ProfileAvatar for a message with a resolved pubkey', () => {
    render(CallChatPanel, { props });
    const avatar = screen.getByTestId('profile-avatar-stub');
    expect(avatar.dataset.pubkey).toBe('b'.repeat(64));
  });

  // Guests get a real generated keypair too (guest-account.js), so in
  // practice every identity resolves — this covers the defensive fallback
  // for an identity that does not (malformed/unresolvable).
  it('shows an initials fallback avatar when the identity has no pubkey', () => {
    state.callChat = [{ id: 'g:1', identity: 'weird-identity', text: 'Hallo!', at: 1 }];
    render(CallChatPanel, {
      props: { identityToPubkey: () => null }
    });
    expect(screen.queryByTestId('profile-avatar-stub')).toBeNull();
    const fallback = screen.getByTestId('call-chat-avatar-fallback');
    expect(fallback.textContent.trim()).toBe('W');
  });

  // QA 2026-10-02: hovering/clicking a sender takes you to their profile
  // without losing the call.
  it('links the sender to their profile route', () => {
    render(CallChatPanel, { props });
    const link = screen.getByTestId('call-chat-sender-link');
    expect(link.getAttribute('href')).toBe(profileLink('b'.repeat(64)));
  });

  it('shows the profile hover card content for a resolved sender', async () => {
    render(CallChatPanel, { props });
    const link = screen.getByTestId('call-chat-sender-link');
    // HoverCard toggles open immediately on click (no hover delay to fake).
    await fireEvent.click(link);
    const card = screen.getByTestId('profile-hover-card');
    expect(card.dataset.pubkey).toBe('b'.repeat(64));
  });

  it('pops the call out (when supported) and navigates when a sender is clicked', async () => {
    popout.supported = true;
    render(CallChatPanel, { props });
    await fireEvent.click(screen.getByTestId('call-chat-sender-link'));
    expect(popout.popOutCall).toHaveBeenCalledWith({
      title: 'arbeitszimmer',
      identityToPubkey: props.identityToPubkey
    });
    expect(gotoMock).toHaveBeenCalledWith(profileLink('b'.repeat(64)));
  });

  it('falls back to navigating only when pop-out is not supported', async () => {
    popout.supported = false;
    render(CallChatPanel, { props });
    await fireEvent.click(screen.getByTestId('call-chat-sender-link'));
    expect(popout.popOutCall).not.toHaveBeenCalled();
    expect(gotoMock).toHaveBeenCalledWith(profileLink('b'.repeat(64)));
  });

  it('groups consecutive messages from the same sender under one avatar', () => {
    state.callChat = [
      { id: 'a:1', identity: 'b'.repeat(64) + ':1', text: 'Hallo', at: 1 },
      { id: 'a:2', identity: 'b'.repeat(64) + ':1', text: 'zusammen', at: 2 }
    ];
    render(CallChatPanel, { props });
    expect(screen.getAllByTestId('call-chat-message')).toHaveLength(2);
    expect(screen.getAllByTestId('profile-avatar-stub')).toHaveLength(1);
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

  // QA C4: the greyed input said nothing about why.
  it('explains the disabled composer while not connected, and drops the line once connected', async () => {
    state.isConnected = false;
    const { unmount } = render(CallChatPanel, { props });
    const hint = screen.getByTestId('call-chat-offline');
    expect(hint.textContent.trim()).toBe(m.groups_call_chat_offline());
    expect(screen.getByTestId('call-chat-input').getAttribute('aria-describedby')).toBe(hint.id);
    unmount();
    state.isConnected = true;
    render(CallChatPanel, { props });
    expect(screen.queryByTestId('call-chat-offline')).toBeNull();
  });
});
