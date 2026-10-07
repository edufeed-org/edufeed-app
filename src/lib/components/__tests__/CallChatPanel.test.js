// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

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
// Pop-out is only worth it for a call that is actually live — default to
// live so existing pop-out tests exercise that path; a dedicated test below
// covers the gate itself.
const groupCall = vi.hoisted(() => ({ phase: 'ready', connected: true }));
vi.mock('$lib/groups/group-call.svelte.js', () => ({
  getGroupCallState: () => groupCall
}));

vi.mock(
  '$lib/components/shared/LinkPreview.svelte',
  () => import('./fixtures/LinkPreviewStub.svelte')
);
// The composer is the app's ComposerInput (`:xx` autocomplete + inline custom
// emojis); the picker is the call's lazy CallEmojiPicker.
vi.mock(
  '$lib/stores/mention-candidates.svelte.js',
  () => import('./fixtures/mention-candidates-mock.svelte.js')
);
const SETS = [{ packName: 'Doge', emojis: [{ shortcode: 'doge', url: 'https://x/doge.png' }] }];
vi.mock('$lib/stores/user-emoji-sets.svelte.js', () => ({
  useUserEmojiSets: () => () => SETS
}));
vi.mock(
  '$lib/components/groups/call/CallEmojiPicker.svelte',
  () => import('./fixtures/CallEmojiPickerStub.svelte')
);
const { typeIntoEditor } = await import('./fixtures/editor.js');

const download = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('$lib/groups/call-chat-export.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  downloadTextFile: (/** @type {any[]} */ ...a) => download.fn(...a)
}));

const m = await import('$lib/paraglide/messages');
const unreadMod = await import('$lib/groups/call-chat-unread.svelte.js');
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
  groupCall.phase = 'ready';
  groupCall.connected = true;
  state.localParticipant = undefined;
  state.remoteParticipants = undefined;
  download.fn.mockClear();
});

// Task 19: the chat is gone when the call ends — a .txt keeps it.
describe('CallChatPanel download', () => {
  const button = () => screen.getByRole('button', { name: m.groups_call_chat_download() });

  it('offers "Chat herunterladen" in the panel header, disabled while empty', () => {
    state.callChat = [];
    render(CallChatPanel, { props });
    expect(button().disabled).toBe(true);
    expect(button().closest('[data-testid="call-chat-header"]')).toBeTruthy();
  });

  it('saves the chat as anruf-chat-<channel>-<date>.txt with one line per message', async () => {
    const GUEST = 'c'.repeat(64) + ':1';
    // The store records the guest flag at receipt: still known after the
    // guest left, and for a panel mounted later.
    state.callChat = [
      ...DEFAULT_CHAT,
      { id: 'g:1', identity: GUEST, text: 'Ich bin Gast', at: 2, guest: true }
    ];
    render(CallChatPanel, { props });
    await fireEvent.click(button());
    expect(download.fn).toHaveBeenCalledTimes(1);
    const [filename, text] = download.fn.mock.calls[0];
    expect(filename).toMatch(/^anruf-chat-arbeitszimmer-\d{4}-\d{2}-\d{2}\.txt$/);
    const lines = text.split('\n');
    expect(lines[0]).toBe('arbeitszimmer');
    expect(lines[1]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    expect(lines[4]).toMatch(/^\[\d{2}:\d{2}\] Bea: Hallo zusammen$/);
    expect(lines[5]).toMatch(
      new RegExp(
        `^\\[\\d{2}:\\d{2}\\] ${'c'.repeat(8)} \\(${m.groups_call_guest_badge()}\\): Ich bin Gast$`
      )
    );
  });
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
    // interactiveTrigger mode: opens on focus (keyboard-reachable), not on
    // click (a click only navigates — review fix round 1).
    await fireEvent.focusIn(link);
    const card = screen.getByTestId('profile-hover-card');
    expect(card.dataset.pubkey).toBe('b'.repeat(64));
  });

  // Review fix round 1: the link is the ONLY tab stop for a sender — the
  // HoverCard wrapper around it must add no nested interactive element.
  it('has one tab stop per sender (no nested interactive wrapper)', () => {
    render(CallChatPanel, { props });
    const wrapper = screen.getByTestId('hover-card-wrapper');
    expect(wrapper.getAttribute('role')).toBeNull();
    expect(wrapper.getAttribute('tabindex')).toBeNull();
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

  // Review fix round 1: a connecting/ended/failed call has nothing worth
  // keeping on screen — pop-out is only for a LIVE call.
  it.each([
    ['not connected yet', { phase: 'ready', connected: false }],
    ['not ready (requesting)', { phase: 'requesting', connected: true }],
    ['ended', { phase: 'ended', connected: false }]
  ])('does not pop out when the call is %s, navigates anyway', async (_label, patch) => {
    popout.supported = true;
    Object.assign(groupCall, patch);
    render(CallChatPanel, { props });
    await fireEvent.click(screen.getByTestId('call-chat-sender-link'));
    expect(popout.popOutCall).not.toHaveBeenCalled();
    expect(gotoMock).toHaveBeenCalledWith(profileLink('b'.repeat(64)));
  });

  // Review fix round 1: popOutCall rejecting (e.g. NotAllowedError without a
  // user gesture the browser recognises) must not throw — navigation still
  // happens and nothing is left unhandled.
  it('navigates even when popOutCall rejects', async () => {
    popout.supported = true;
    popout.popOutCall.mockRejectedValueOnce(new Error('NotAllowedError'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(CallChatPanel, { props });
    await fireEvent.click(screen.getByTestId('call-chat-sender-link'));
    await Promise.resolve();
    await Promise.resolve();
    expect(gotoMock).toHaveBeenCalledWith(profileLink('b'.repeat(64)));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // Review fix round 1: the click must not also bubble into HoverCard's own
  // click handling (or anything else above it) — it only navigates.
  it('stops the click event from propagating past the sender link', async () => {
    render(CallChatPanel, { props });
    const link = screen.getByTestId('call-chat-sender-link');
    const outerHandler = vi.fn();
    document.body.addEventListener('click', outerHandler);
    await fireEvent.click(link);
    document.body.removeEventListener('click', outerHandler);
    expect(outerHandler).not.toHaveBeenCalled();
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
    await typeIntoEditor(input, 'Moin');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat).toHaveBeenCalledWith('Moin', expect.objectContaining({ emoji: [] }));
    expect(input.textContent).toBe('');
  });

  // The server ended the call (removed / dropped): the messages stay
  // readable, but nothing can be sent into a dead Room.
  it('disables the composer while not connected', async () => {
    state.isConnected = false;
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(input.getAttribute('contenteditable')).toBe('false');
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

// Issue "render links in call chats and preview links".
describe('CallChatPanel links', () => {
  const NADDR = 'naddr1' + 'q'.repeat(70);
  /** @param {string} text */
  const say = (text) => {
    state.callChat = [{ id: 'l:1', identity: 'b'.repeat(64) + ':1', text, at: 1 }];
  };
  const links = () =>
    /** @type {HTMLAnchorElement[]} */ (
      Array.from(
        screen.getByTestId('call-chat-message').querySelectorAll('a[data-testid="call-chat-link"]')
      )
    );

  it('makes an external URL a new-tab link and previews it under the message', () => {
    say('Schaut mal https://example.com/artikel.');
    render(CallChatPanel, { props });
    const [a] = links();
    expect(a.getAttribute('href')).toBe('https://example.com/artikel');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.textContent).toBe('https://example.com/artikel');
    expect(screen.getByTestId('call-chat-message').textContent).toContain('Schaut mal');
    const previews = screen.getAllByTestId('link-preview-stub');
    expect(previews.map((p) => p.dataset.url)).toEqual(['https://example.com/artikel']);
  });

  it('keeps raw HTML as text', () => {
    say('<img src=x onerror="alert(1)"> <b>fett</b>');
    render(CallChatPanel, { props });
    const msg = screen.getByTestId('call-chat-message');
    expect(msg.querySelector('img')).toBeNull();
    expect(msg.querySelector('b')).toBeNull();
    expect(msg.textContent).toContain('<b>fett</b>');
  });

  it('an app link pops the call out and navigates in-app instead of leaving the page', async () => {
    popout.supported = true;
    say(`nostr:${NADDR}`);
    render(CallChatPanel, { props });
    const [a] = links();
    expect(a.getAttribute('href')).toBe(`/${NADDR}`);
    expect(a.getAttribute('target')).toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(popout.popOutCall).toHaveBeenCalledTimes(1);
    expect(gotoMock).toHaveBeenCalledWith(`/${NADDR}`);
    // The app is not an external page: no preview card for it.
    expect(screen.queryByTestId('link-preview-stub')).toBeNull();
  });

  it('a same-origin URL counts as an app link too', async () => {
    say(`${window.location.origin}/${NADDR}`);
    render(CallChatPanel, { props });
    const [a] = links();
    expect(a.getAttribute('href')).toBe(`/${NADDR}`);
    await fireEvent.click(a);
    expect(gotoMock).toHaveBeenCalledWith(`/${NADDR}`);
  });

  it('leaves a modified click (new tab) to the browser', async () => {
    say(`nostr:${NADDR}`);
    render(CallChatPanel, { props });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    links()[0].dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(gotoMock).not.toHaveBeenCalled();
    expect(popout.popOutCall).not.toHaveBeenCalled();
  });

  it('an external link never navigates the app', async () => {
    say('https://example.com/');
    render(CallChatPanel, { props });
    await fireEvent.click(links()[0]);
    expect(gotoMock).not.toHaveBeenCalled();
  });
});

describe('CallChatPanel unread marker', () => {
  it('marks the call chat seen while the panel is on screen', () => {
    unreadMod.resetCallChatUnread();
    unreadMod.noteCallChatReceived();
    const unread = unreadMod.getCallChatUnread();
    expect(unread.count).toBe(1);
    const { unmount } = render(CallChatPanel, { props });
    expect(unread.count).toBe(0);
    unreadMod.noteCallChatReceived();
    expect(unread.count).toBe(0);
    unmount();
    unreadMod.noteCallChatReceived();
    expect(unread.count).toBe(1);
  });
});

// Issue "Video-Call chat: emoji picker and :shortcode: autocomplete".
describe('CallChatPanel emojis', () => {
  it('suggests custom emojis on ":" and sends the pick as a [shortcode, url] pair', async () => {
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    await typeIntoEditor(input, 'los :dog');
    await screen.findByRole('listbox');
    await fireEvent.keyDown(input, { key: 'Enter' }); // pick
    expect(input.querySelector('img[data-shortcode="doge"]')).toBeTruthy();
    await fireEvent.keyDown(input, { key: 'Enter' }); // send
    expect(sendCallChat).toHaveBeenCalledWith('los :doge:', {
      emoji: [['doge', 'https://x/doge.png']]
    });
  });

  it('opens the emoji picker from a button and inserts the pick into the draft', async () => {
    render(CallChatPanel, { props });
    const toggle = screen.getByRole('button', { name: m.groups_call_chat_emoji_button() });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(toggle);
    const picker = await waitFor(() => screen.getByTestId('call-emoji-picker-stub'));
    await fireEvent.click(picker.querySelector('button')); // 🫶
    const input = screen.getByTestId('call-chat-input');
    await waitFor(() => expect(input.textContent).toContain('🫶'));
    // picking closes the picker
    expect(screen.queryByTestId('call-emoji-picker-stub')).toBeNull();
  });

  it('a custom pick from the picker travels as a pair even when it is not in my packs', async () => {
    render(CallChatPanel, { props });
    await fireEvent.click(screen.getByRole('button', { name: m.groups_call_chat_emoji_button() }));
    const picker = await waitFor(() => screen.getByTestId('call-emoji-picker-stub'));
    await fireEvent.click(picker.querySelectorAll('button')[1]); // :parrot:
    const input = screen.getByTestId('call-chat-input');
    await waitFor(() => expect(input.querySelector('img[data-shortcode="parrot"]')).toBeTruthy());
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat).toHaveBeenCalledWith(':parrot:', {
      emoji: [['parrot', 'https://x.org/p.gif']]
    });
  });

  it('renders a received custom emoji inline as its image, undeclared codes as text', () => {
    state.callChat = [
      {
        id: 'e:1',
        identity: 'b'.repeat(64) + ':1',
        text: ':party: los :nope:',
        at: 1,
        emoji: [['party', 'https://cdn.example/party.png']]
      }
    ];
    render(CallChatPanel, { props });
    const msg = screen.getByTestId('call-chat-message');
    const img = msg.querySelector('img[alt=":party:"]');
    expect(img).toBeTruthy();
    expect(msg.textContent).toContain(':nope:');
    expect(msg.textContent).not.toContain(':party:');
  });

  it('keeps the picker button disabled while not connected', () => {
    state.isConnected = false;
    render(CallChatPanel, { props });
    expect(screen.getByRole('button', { name: m.groups_call_chat_emoji_button() }).disabled).toBe(
      true
    );
  });
});
