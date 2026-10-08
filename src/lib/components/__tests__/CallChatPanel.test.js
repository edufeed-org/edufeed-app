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
const sendCallFile = vi.fn(async () => ({ ok: true }));
vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  CALL_FILE_MAX_BYTES: 25 * 1024 * 1024,
  getLiveKitState: () => state,
  sendCallChat: (...a) => sendCallChat(...a),
  sendCallFile: (...a) => sendCallFile(...a)
}));
const toast = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: (...a) => toast.fn(...a) }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () =>
    new Map([
      ['b'.repeat(64), { name: 'Bea' }],
      ['c'.repeat(64), { name: 'Carl Otto' }]
    ])
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
  sendCallFile.mockClear();
  sendCallFile.mockResolvedValue({ ok: true });
  toast.fn.mockClear();
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
    const GUEST = 'd'.repeat(64) + ':1';
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
        `^\\[\\d{2}:\\d{2}\\] ${'d'.repeat(8)} \\(${m.groups_call_guest_badge()}\\): Ich bin Gast$`
      )
    );
  });
});

describe('CallChatPanel close control', () => {
  // Issue "collapse/close control inside the chat panel": the panel used to
  // close only through the stage header's Chat toggle.
  it('offers a close button in the header only when the parent can close it', async () => {
    const { unmount } = render(CallChatPanel, { props });
    expect(screen.queryByTestId('call-chat-close')).toBeNull();
    unmount();
    const onClose = vi.fn();
    render(CallChatPanel, { props: { ...props, onClose } });
    const button = screen.getByTestId('call-chat-close');
    expect(button.getAttribute('aria-label')).toBe(m.groups_call_chat_close());
    expect(button.className).toContain('btn-ghost');
    await fireEvent.click(button);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape in an empty composer closes the panel; a draft keeps it open', async () => {
    const onClose = vi.fn();
    render(CallChatPanel, { props: { ...props, onClose } });
    const input = screen.getByTestId('call-chat-input');
    await typeIntoEditor(input, 'half-typed');
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await typeIntoEditor(input, '');
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels an active reply quote before it closes the panel', async () => {
    const onClose = vi.fn();
    state.callChat = [
      { id: 'o:1', identity: 'b'.repeat(64) + ':1', text: 'Hallo zusammen', at: 1 }
    ];
    render(CallChatPanel, { props: { ...props, onClose } });
    const msg = screen.getByTestId('call-chat-message');
    await fireEvent.click(
      /** @type {HTMLElement} */ (msg.querySelector('[data-testid="call-chat-reply"]'))
    );
    const input = screen.getByTestId('call-chat-input');
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('call-chat-reply-strip')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('without onClose, Escape does nothing and sends nothing', async () => {
    render(CallChatPanel, { props });
    await fireEvent.keyDown(screen.getByTestId('call-chat-input'), { key: 'Escape' });
    expect(sendCallChat).not.toHaveBeenCalled();
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
    expect(sendCallChat).toHaveBeenCalledWith(
      'los :doge:',
      expect.objectContaining({ emoji: [['doge', 'https://x/doge.png']] })
    );
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
    expect(sendCallChat).toHaveBeenCalledWith(
      ':parrot:',
      expect.objectContaining({ emoji: [['parrot', 'https://x.org/p.gif']] })
    );
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

  // Smoke test 2026-10-08: the picker showed no custom emojis. The panel
  // hands its own packs over, so picker and `:xx` autocomplete always agree.
  it('hands its own custom emoji packs to the picker', async () => {
    render(CallChatPanel, { props });
    await fireEvent.click(screen.getByRole('button', { name: m.groups_call_chat_emoji_button() }));
    const picker = await waitFor(() => screen.getByTestId('call-emoji-picker-stub'));
    expect(JSON.parse(picker.dataset.sets)).toEqual(SETS);
  });

  it('keeps the picker button disabled while not connected', () => {
    state.isConnected = false;
    render(CallChatPanel, { props });
    expect(screen.getByRole('button', { name: m.groups_call_chat_emoji_button() }).disabled).toBe(
      true
    );
  });
});

// Smoke test 2026-10-08: "the input field is much too small" — one row with
// attach, emoji, recipient, input and Senden squeezed the input to ~90px.
describe('CallChatPanel composer layout', () => {
  const ME = 'e'.repeat(64) + ':me';
  const BEA = 'b'.repeat(64) + ':1';
  beforeEach(() => {
    state.localParticipant = { identity: ME };
    state.remoteParticipants = [{ identity: BEA }];
  });

  it('gives the input its own row (with Senden only) and puts the controls in a toolbar below', () => {
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    const row = input.closest('[data-testid="call-chat-input-row"]');
    expect(row).toBeTruthy();
    for (const id of ['call-chat-attach', 'call-chat-emoji-toggle', 'call-chat-recipient']) {
      expect(row.querySelector(`[data-testid="${id}"]`)).toBeNull();
    }
    expect(row.querySelector('[data-testid="call-chat-send"]')).toBeTruthy();
    const toolbar = screen.getByTestId('call-chat-toolbar');
    for (const id of ['call-chat-attach', 'call-chat-emoji-toggle', 'call-chat-recipient']) {
      expect(toolbar.querySelector(`[data-testid="${id}"]`)).toBeTruthy();
    }
    // the toolbar follows the input row
    expect(row.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.contains(toolbar)).toBe(false);
  });

  it('is a multiline field; Senden is an icon button that keeps its label', () => {
    render(CallChatPanel, { props });
    expect(screen.getByTestId('call-chat-input').getAttribute('aria-multiline')).toBe('true');
    const send = screen.getByTestId('call-chat-send');
    expect(send.getAttribute('aria-label')).toBe(m.groups_call_chat_send());
    expect(send.className).toContain('btn-square');
    expect(send.textContent.trim()).toBe('');
  });

  it('the recipient control reads "An: Alle", and "An: <Name>" with a lock once someone is chosen', async () => {
    render(CallChatPanel, { props });
    const control = screen.getByTestId('call-chat-recipient-control');
    expect(control.textContent).toContain(m.groups_call_chat_to_everyone());
    expect(control.dataset.private).toBeUndefined();
    expect(control.querySelector('svg')).toBeNull();
    const row = screen.getByTestId('call-chat-input-row');
    expect(row.dataset.private).toBeUndefined();
    expect(row.className).not.toContain('border-secondary');
    await fireEvent.change(screen.getByTestId('call-chat-recipient'), { target: { value: BEA } });
    expect(control.textContent).toContain(m.groups_call_chat_to_name({ name: 'Bea' }));
    expect(control.dataset.private).toBe('true');
    expect(control.querySelector('svg')).toBeTruthy();
    // the field itself is tinted like a private message
    expect(row.dataset.private).toBe('true');
    expect(row.className).toContain('border-secondary');
  });

  it('keeps the offline hint and the reply strip above the input', async () => {
    state.isConnected = false;
    const { unmount } = render(CallChatPanel, { props });
    const hint = screen.getByTestId('call-chat-offline');
    const row = screen.getByTestId('call-chat-input-row');
    expect(hint.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    state.isConnected = true;
    render(CallChatPanel, { props });
    await fireEvent.click(
      screen.getByTestId('call-chat-message').querySelector('[data-testid="call-chat-reply"]')
    );
    const strip = screen.getByTestId('call-chat-reply-strip');
    const row2 = screen.getByTestId('call-chat-input-row');
    expect(strip.compareDocumentPosition(row2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// Issue "Video-Call chat: reply-to".
describe('CallChatPanel replies', () => {
  const BEA = 'b'.repeat(64) + ':1';
  const ORIGINAL = {
    id: '11111111-2222-4333-8444-555555555555',
    identity: BEA,
    text: 'erste Zeile\nzweite Zeile',
    at: 1
  };
  const replyButton = (row) => row.querySelector('[data-testid="call-chat-reply"]');

  it('offers "Antworten" on a message; choosing it shows the quote strip, cancel clears it', async () => {
    state.callChat = [ORIGINAL];
    render(CallChatPanel, { props });
    const row = screen.getByTestId('call-chat-message');
    const button = replyButton(row);
    expect(button.getAttribute('aria-label')).toBe(m.groups_call_chat_reply());
    await fireEvent.click(button);
    const strip = screen.getByTestId('call-chat-reply-strip');
    expect(strip.textContent).toContain(m.groups_call_chat_replying_to({ name: 'Bea' }));
    expect(strip.textContent).toContain('erste Zeile');
    expect(strip.textContent).not.toContain('zweite Zeile');
    await fireEvent.click(screen.getByRole('button', { name: m.groups_call_chat_reply_cancel() }));
    expect(screen.queryByTestId('call-chat-reply-strip')).toBeNull();
  });

  it('sends replyTo + replyPreview (author, first line) and drops the quote afterwards', async () => {
    state.callChat = [ORIGINAL];
    render(CallChatPanel, { props });
    await fireEvent.click(replyButton(screen.getByTestId('call-chat-message')));
    const input = screen.getByTestId('call-chat-input');
    await typeIntoEditor(input, 'dazu: ja');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat).toHaveBeenCalledWith(
      'dazu: ja',
      expect.objectContaining({
        replyTo: ORIGINAL.id,
        replyPreview: { n: 'Bea', text: 'erste Zeile' }
      })
    );
    expect(screen.queryByTestId('call-chat-reply-strip')).toBeNull();
  });

  it('escape in the composer cancels the reply', async () => {
    state.callChat = [ORIGINAL];
    render(CallChatPanel, { props });
    await fireEvent.click(replyButton(screen.getByTestId('call-chat-message')));
    await fireEvent.keyDown(screen.getByTestId('call-chat-input'), { key: 'Escape' });
    expect(screen.queryByTestId('call-chat-reply-strip')).toBeNull();
  });

  it('shows the quoted author + line above a reply, from the original when it is present, and jumps to it', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    state.callChat = [
      ORIGINAL,
      {
        id: 'r:1',
        identity: 'c'.repeat(64) + ':1',
        text: 'dazu: ja',
        at: 2,
        replyTo: ORIGINAL.id,
        // the sender's preview may be stale: the live original wins
        replyPreview: { n: 'B.', text: 'veraltet' }
      }
    ];
    render(CallChatPanel, { props });
    const [, reply] = screen.getAllByTestId('call-chat-message');
    const quote = reply.querySelector('[data-testid="call-chat-quote"]');
    expect(quote.tagName).toBe('BUTTON');
    expect(quote.textContent).toContain('Bea');
    expect(quote.textContent).toContain('erste Zeile');
    expect(quote.textContent).not.toContain('veraltet');
    await fireEvent.click(quote);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const [original] = screen.getAllByTestId('call-chat-message');
    expect(original.dataset.flash).toBe('true');
  });

  it('falls back to the embedded preview (not clickable) when the original is missing', () => {
    state.callChat = [
      {
        id: 'r:1',
        identity: 'c'.repeat(64) + ':1',
        text: 'dazu: ja',
        at: 2,
        replyTo: '99999999-2222-4333-8444-555555555555',
        replyPreview: { n: 'Bea', text: 'erste Zeile' }
      }
    ];
    render(CallChatPanel, { props });
    const quote = screen.getByTestId('call-chat-quote');
    expect(quote.tagName).not.toBe('BUTTON');
    expect(quote.textContent).toContain('Bea');
    expect(quote.textContent).toContain('erste Zeile');
  });

  it('hides the reply action while nothing can be sent', () => {
    state.isConnected = false;
    state.callChat = [ORIGINAL];
    render(CallChatPanel, { props });
    expect(replyButton(screen.getByTestId('call-chat-message'))).toBeNull();
  });
});

// Issue "Video-Call chat: @mentions of call participants".
describe('CallChatPanel mentions', () => {
  const ME = 'e'.repeat(64) + ':me';
  const BEA = 'b'.repeat(64) + ':1';
  const CARL = 'c'.repeat(64) + ':1';
  beforeEach(() => {
    state.localParticipant = { identity: ME };
    state.remoteParticipants = [{ identity: BEA }, { identity: CARL }];
  });

  it('suggests "alle" and the other participants on "@" and sends the picked identities', async () => {
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    await typeIntoEditor(input, 'hey @');
    const list = await screen.findByRole('listbox');
    const options = Array.from(list.querySelectorAll('[role="option"]')).map((o) =>
      o.lastElementChild.textContent.trim()
    );
    expect(options).toEqual([m.groups_call_chat_mention_everyone(), 'Bea', 'Carl Otto']);
    await fireEvent.keyDown(input, { key: 'ArrowDown' }); // Bea
    await fireEvent.keyDown(input, { key: 'Enter' }); // pick
    expect(input.textContent).toBe('hey @Bea ');
    await typeIntoEditor(input, 'hey @Bea und @Car');
    await screen.findByRole('listbox');
    await fireEvent.keyDown(input, { key: 'Enter' }); // Carl Otto
    expect(input.textContent).toBe('hey @Bea und @Carl Otto ');
    await fireEvent.keyDown(input, { key: 'Enter' }); // send
    expect(sendCallChat).toHaveBeenCalledWith(
      'hey @Bea und @Carl Otto',
      expect.objectContaining({ mentions: [BEA, CARL] })
    );
  });

  it('"@alle" is sent as "*"', async () => {
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    await typeIntoEditor(input, '@al');
    await screen.findByRole('listbox');
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat).toHaveBeenCalledWith(
      `@${m.groups_call_chat_mention_everyone()}`,
      expect.objectContaining({ mentions: ['*'] })
    );
  });

  it('drops a mention whose @Name was deleted from the draft again', async () => {
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    await typeIntoEditor(input, '@Be');
    await screen.findByRole('listbox');
    await fireEvent.keyDown(input, { key: 'Enter' });
    await typeIntoEditor(input, 'doch nicht');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat).toHaveBeenCalledWith(
      'doch nicht',
      expect.objectContaining({ mentions: [] })
    );
  });

  it('renders mentioned names as chips and highlights a message that mentions me', () => {
    state.callChat = [
      { id: 'm:1', identity: BEA, text: 'hey @Carl Otto schau', at: 1, mentions: [CARL] },
      { id: 'm:2', identity: BEA, text: '@alle her', at: 2, mentions: ['*'] },
      { id: 'm:3', identity: CARL, text: 'nur text @Bea', at: 3 }
    ];
    render(CallChatPanel, { props });
    const [toCarl, toAll, plain] = screen.getAllByTestId('call-chat-message');
    const chip = toCarl.querySelector('[data-testid="call-chat-mention"]');
    expect(chip.textContent).toBe('@Carl Otto');
    expect(toCarl.dataset.mentioned).toBeUndefined();
    // the chip keeps what the sender typed (a German "@alle" on an English UI too)
    expect(toAll.querySelector('[data-testid="call-chat-mention"]').textContent).toBe('@alle');
    expect(toAll.dataset.mentioned).toBe('true');
    expect(plain.querySelector('[data-testid="call-chat-mention"]')).toBeNull();
  });
});

// Issue "Video-Call: private 1:1 messages in the call chat".
describe('CallChatPanel private messages', () => {
  const ME = 'e'.repeat(64) + ':me';
  const BEA = 'b'.repeat(64) + ':1';
  const CARL = 'c'.repeat(64) + ':1';
  const select = () =>
    /** @type {HTMLSelectElement} */ (
      screen.getByRole('combobox', { name: m.groups_call_chat_recipient() })
    );
  beforeEach(() => {
    state.localParticipant = { identity: ME };
    state.remoteParticipants = [{ identity: BEA }, { identity: CARL }];
  });

  it('offers "An: Alle" plus the other participants and sends to the chosen one only', async () => {
    render(CallChatPanel, { props });
    const options = Array.from(select().options).map((o) => o.textContent.trim());
    expect(options).toEqual([m.groups_call_chat_to_everyone(), 'Bea', 'Carl Otto']);
    await fireEvent.change(select(), { target: { value: BEA } });
    const input = screen.getByTestId('call-chat-input');
    expect(input.getAttribute('aria-placeholder')).toBe(
      m.groups_call_chat_placeholder_private({ name: 'Bea' })
    );
    await typeIntoEditor(input, 'nur du');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat).toHaveBeenCalledWith('nur du', expect.objectContaining({ to: BEA }));
    // the choice stays until changed (a private exchange is usually several lines)
    expect(select().value).toBe(BEA);
  });

  it('sends to everyone by default', async () => {
    render(CallChatPanel, { props });
    const input = screen.getByTestId('call-chat-input');
    await typeIntoEditor(input, 'an alle');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat.mock.calls[0][1].to).toBeUndefined();
  });

  it('marks my own private copy "privat an X" and a received one "privat von X"', () => {
    state.callChat = [
      { id: 'p:1', identity: ME, text: 'nur du', at: 1, to: BEA },
      { id: 'p:2', identity: BEA, text: 'ok', at: 2, to: ME },
      { id: 'p:3', identity: CARL, text: 'alle', at: 3 }
    ];
    render(CallChatPanel, { props: { identityToPubkey: (id) => id.slice(0, 64) } });
    const [mine, theirs, open] = screen.getAllByTestId('call-chat-message');
    expect(mine.dataset.private).toBe('true');
    expect(mine.querySelector('[data-testid="call-chat-private-badge"]').textContent).toBe(
      m.groups_call_chat_private_to({ name: 'Bea' })
    );
    expect(theirs.querySelector('[data-testid="call-chat-private-badge"]').textContent).toBe(
      m.groups_call_chat_private_from({ name: 'Bea' })
    );
    expect(open.dataset.private).toBeUndefined();
    expect(open.querySelector('[data-testid="call-chat-private-badge"]')).toBeNull();
  });

  it('takes a recipient requested from a participant tile', async () => {
    const compose = await import('$lib/groups/call-chat-compose.svelte.js');
    compose.requestPrivateRecipient(CARL);
    render(CallChatPanel, { props });
    await waitFor(() => expect(select().value).toBe(CARL));
    expect(compose.getCallChatCompose().recipient).toBeNull();
  });

  it('falls back to everyone when the chosen recipient leaves the call', async () => {
    const { rerender } = render(CallChatPanel, { props });
    await fireEvent.change(select(), { target: { value: CARL } });
    expect(select().value).toBe(CARL);
    state.remoteParticipants = [{ identity: BEA }];
    await rerender(props);
    await waitFor(() => expect(select().value).toBe(''));
  });

  it('exports private messages with a note, never as plain lines', async () => {
    state.callChat = [{ id: 'p:1', identity: ME, text: 'nur du', at: 1, to: BEA }];
    render(CallChatPanel, { props: { identityToPubkey: (id) => id.slice(0, 64), title: 'x' } });
    await fireEvent.click(screen.getByRole('button', { name: m.groups_call_chat_download() }));
    const [, text] = download.fn.mock.calls[0];
    expect(text).toContain(`(${m.groups_call_chat_private_to({ name: 'Bea' })}): nur du`);
  });
});

// Issue "Video-Call chat: share files without storing them publicly".
describe('CallChatPanel files', () => {
  const ME = 'e'.repeat(64) + ':me';
  const BEA = 'b'.repeat(64) + ':1';
  const attachInput = () =>
    /** @type {HTMLInputElement} */ (screen.getByTestId('call-chat-attach-input'));
  const pick = async (file) => {
    const input = attachInput();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await fireEvent.change(input);
  };
  beforeEach(() => {
    state.localParticipant = { identity: ME };
    state.remoteParticipants = [{ identity: BEA }];
  });

  it('offers an attach button that hands the picked file to the service, privately when a recipient is chosen', async () => {
    render(CallChatPanel, { props });
    expect(screen.getByRole('button', { name: m.chat_attach_file() })).toBeTruthy();
    const file = new File(['abc'], 'notizen.txt', { type: 'text/plain' });
    await pick(file);
    expect(sendCallFile).toHaveBeenCalledWith(file, { to: undefined });
    await fireEvent.change(screen.getByTestId('call-chat-recipient'), { target: { value: BEA } });
    await pick(file);
    expect(sendCallFile).toHaveBeenLastCalledWith(file, { to: BEA });
  });

  it('sends files pasted into the composer, privately when a recipient is chosen', async () => {
    render(CallChatPanel, { props });
    const file = new File(['abc'], 'shot.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [file], getData: () => '' } });
    screen.getByTestId('call-chat-input').dispatchEvent(paste);
    await waitFor(() => expect(sendCallFile).toHaveBeenCalledWith(file, { to: undefined }));
    await fireEvent.change(screen.getByTestId('call-chat-recipient'), { target: { value: BEA } });
    screen.getByTestId('call-chat-input').dispatchEvent(paste);
    await waitFor(() => expect(sendCallFile).toHaveBeenLastCalledWith(file, { to: BEA }));
  });

  it('sends files dropped on the composer row, one after another', async () => {
    render(CallChatPanel, { props });
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    const row = screen.getByTestId('call-chat-input-row');
    const enter = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(enter, 'dataTransfer', { value: { files: [], types: ['Files'] } });
    row.dispatchEvent(enter);
    expect(row.dataset.dragging).toBe('true');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [a, b], types: ['Files'] } });
    row.dispatchEvent(drop);
    await waitFor(() => expect(sendCallFile).toHaveBeenCalledTimes(2));
    expect(sendCallFile.mock.calls.map((c) => c[0])).toEqual([a, b]);
    expect(row.dataset.dragging).toBeUndefined();
  });

  it('ignores pasted files while nothing can be sent', async () => {
    state.canSignal = false;
    render(CallChatPanel, { props });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['x'], 'x.png', { type: 'image/png' })], getData: () => '' }
    });
    screen.getByTestId('call-chat-input').dispatchEvent(paste);
    await Promise.resolve();
    expect(sendCallFile).not.toHaveBeenCalled();
  });

  it('toasts when the service refuses a too-large file', async () => {
    sendCallFile.mockResolvedValue({ ok: false, error: 'too-large' });
    render(CallChatPanel, { props });
    await pick(new File(['x'], 'big.bin'));
    await waitFor(() => expect(toast.fn).toHaveBeenCalledTimes(1));
    expect(toast.fn.mock.calls[0][0]).toBe(m.groups_call_chat_file_too_large({ max: '25.0 MB' }));
  });

  it('renders a transfer in progress with name, size and a progress bar', () => {
    state.callChat = [
      {
        id: 'f:1',
        identity: ME,
        text: '',
        at: 1,
        file: {
          name: 'folien.pdf',
          size: 2 * 1024 * 1024,
          mime: 'application/pdf',
          status: 'sending',
          progress: 0.4
        }
      }
    ];
    render(CallChatPanel, { props });
    const bubble = screen.getByTestId('call-chat-file');
    expect(bubble.textContent).toContain('folien.pdf');
    expect(bubble.textContent).toContain('2.0 MB');
    expect(bubble.textContent).toContain(m.groups_call_chat_file_sending());
    const bar = /** @type {HTMLProgressElement} */ (bubble.querySelector('progress'));
    expect(bar.value).toBe(40);
    expect(bubble.querySelector('a[download]')).toBeNull();
  });

  it('renders a received file with a download link, and an inline preview for an image', () => {
    state.callChat = [
      {
        id: 'f:2',
        identity: BEA,
        text: '',
        at: 1,
        file: {
          name: 'bild.png',
          size: 1234,
          mime: 'image/png',
          status: 'done',
          progress: 1,
          url: 'blob:img'
        }
      },
      {
        id: 'f:3',
        identity: BEA,
        text: '',
        at: 2,
        file: {
          name: 'daten.csv',
          size: 99,
          mime: 'text/csv',
          status: 'done',
          progress: 1,
          url: 'blob:csv'
        }
      }
    ];
    render(CallChatPanel, { props });
    const [img, csv] = screen.getAllByTestId('call-chat-file');
    expect(img.querySelector('img').getAttribute('src')).toBe('blob:img');
    const link = /** @type {HTMLAnchorElement} */ (img.querySelector('a[download]'));
    expect(link.getAttribute('href')).toBe('blob:img');
    expect(link.getAttribute('download')).toBe('bild.png');
    expect(csv.querySelector('img')).toBeNull();
    expect(csv.querySelector('a[download]').getAttribute('href')).toBe('blob:csv');
    expect(csv.textContent).toContain('99 B');
    // The blob is same-origin: the preview is never a link that opens it as
    // a document, and only the download link points at it.
    expect(img.querySelector('a:not([download])')).toBeNull();
    expect(img.querySelector('a[target]')).toBeNull();
  });

  it('never previews a file outside the raster allowlist, however it is typed', () => {
    state.callChat = [
      {
        id: 'f:5',
        identity: BEA,
        text: '',
        at: 1,
        file: {
          name: 'logo.svg',
          size: 12,
          mime: 'image/svg+xml',
          status: 'done',
          progress: 1,
          url: 'blob:svg'
        }
      }
    ];
    render(CallChatPanel, { props });
    const bubble = screen.getByTestId('call-chat-file');
    expect(bubble.querySelector('img')).toBeNull();
    expect(bubble.querySelector('a[download]').getAttribute('href')).toBe('blob:svg');
  });

  it('says so when a transfer failed', () => {
    state.callChat = [
      {
        id: 'f:4',
        identity: BEA,
        text: '',
        at: 1,
        file: { name: 'x.zip', size: 5, mime: 'application/zip', status: 'failed', progress: 0.2 }
      }
    ];
    render(CallChatPanel, { props });
    expect(screen.getByTestId('call-chat-file').textContent).toContain(
      m.groups_call_chat_file_failed()
    );
  });

  it('exports a file message as its name only', async () => {
    state.callChat = [
      {
        id: 'f:5',
        identity: BEA,
        text: '',
        at: 1,
        file: {
          name: 'folien.pdf',
          size: 5,
          mime: 'application/pdf',
          status: 'done',
          progress: 1,
          url: 'blob:p'
        }
      }
    ];
    render(CallChatPanel, { props: { ...props, title: 'x' } });
    await fireEvent.click(screen.getByRole('button', { name: m.groups_call_chat_download() }));
    const [, text] = download.fn.mock.calls[0];
    expect(text).toContain(`Bea: [${m.groups_call_chat_file_label()}] folien.pdf`);
  });

  it('hides the attach button while nothing can be sent', () => {
    state.isConnected = false;
    render(CallChatPanel, { props });
    expect(screen.queryByRole('button', { name: m.chat_attach_file() })).toBeNull();
  });
});
