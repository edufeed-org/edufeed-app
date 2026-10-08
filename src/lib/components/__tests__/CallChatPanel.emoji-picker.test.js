// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * CallChatPanel with the REAL CallEmojiPicker + EmojiPicker (CallChatPanel.test.js
 * stubs the picker): the user's NIP-30 packs show up in the opened picker and a
 * pick lands in the composer as `:shortcode:` — smoke test 2026-10-08 found the
 * call picker without the custom emojis the channel chat offers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

if (!Element.prototype.animate) {
  Element.prototype.animate = function () {
    const finishedPromise = Promise.resolve();
    const anim = {
      onfinish: null,
      cancel: vi.fn(),
      finished: finishedPromise,
      playState: 'finished'
    };
    finishedPromise.then(() => anim.onfinish?.());
    return anim;
  };
}

const state = {
  callChat: [],
  canSignal: true,
  isConnected: true,
  localParticipant: undefined,
  remoteParticipants: undefined
};
const sendCallChat = vi.fn(async () => {});
vi.mock('$lib/services/livekit-connection.svelte.js', () => ({
  CALL_FILE_MAX_BYTES: 25 * 1024 * 1024,
  getLiveKitState: () => state,
  sendCallChat: (...a) => sendCallChat(...a),
  sendCallFile: vi.fn(async () => ({ ok: true }))
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock(
  '$lib/components/shared/ProfileAvatar.svelte',
  () => import('./fixtures/ProfileAvatarStub.svelte')
);
vi.mock(
  '$lib/components/shared/ProfileHoverCardContent.svelte',
  () => import('./fixtures/ProfileHoverCardContentStub.svelte')
);
vi.mock(
  '$lib/components/shared/LinkPreview.svelte',
  () => import('./fixtures/LinkPreviewStub.svelte')
);
vi.mock('$app/paths', () => ({ resolve: (path) => path }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/groups/call-popout.svelte.js', () => ({
  canPopOutCall: () => false,
  popOutCall: vi.fn(async () => {})
}));
vi.mock('$lib/groups/group-call.svelte.js', () => ({
  getGroupCallState: () => ({ phase: 'ready', connected: true })
}));
vi.mock(
  '$lib/stores/mention-candidates.svelte.js',
  () => import('./fixtures/mention-candidates-mock.svelte.js')
);
// EmojiPicker's recently-used row is keyed per account.
const account = vi.hoisted(() => ({ manager: { active: { pubkey: 'alice' } } }));
vi.mock('$lib/stores/accounts.svelte', () => account);

// One pack, as useUserEmojiSets() hands it out once kind 10030 → 30030 resolved.
const SETS = [{ packName: 'Doge', emojis: [{ shortcode: 'doge', url: 'https://x/doge.png' }] }];
const emojiSets = vi.hoisted(() => ({ calls: 0 }));
vi.mock('$lib/stores/user-emoji-sets.svelte.js', () => ({
  useUserEmojiSets: () => {
    emojiSets.calls += 1;
    return () => SETS;
  }
}));

const m = await import('$lib/paraglide/messages');
const { default: CallChatPanel } = await import('$lib/components/groups/call/CallChatPanel.svelte');
const props = { identityToPubkey: (id) => id.slice(0, 64), title: 'arbeitszimmer' };

beforeEach(() => {
  localStorage.clear();
  sendCallChat.mockClear();
  emojiSets.calls = 0;
});

describe('CallChatPanel emoji picker (real picker)', () => {
  it('shows the user’s custom pack in the opened picker and inserts a pick as :shortcode:', async () => {
    render(CallChatPanel, { props });
    await fireEvent.click(screen.getByRole('button', { name: m.groups_call_chat_emoji_button() }));
    // the lazy picker + its emoji dataset load asynchronously
    const option = await waitFor(
      () => {
        const el = screen
          .getByTestId('call-emoji-picker')
          .querySelector('[data-testid="custom-emoji-option"][title=":doge:"]');
        if (!el) throw new Error('custom emoji not rendered yet');
        return el;
      },
      { timeout: 5000 }
    );
    expect(screen.getByTestId('call-emoji-picker').textContent).toContain('Doge');
    await fireEvent.click(option);
    const input = screen.getByTestId('call-chat-input');
    await waitFor(() => expect(input.querySelector('img[data-shortcode="doge"]')).toBeTruthy());
    expect(screen.queryByTestId('call-emoji-picker')).toBeNull();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendCallChat).toHaveBeenCalledWith(
      ':doge:',
      expect.objectContaining({ emoji: [['doge', 'https://x/doge.png']] })
    );
  });

  it('the picker reuses the panel’s packs instead of loading its own', async () => {
    render(CallChatPanel, { props });
    expect(emojiSets.calls).toBe(1);
    await fireEvent.click(screen.getByRole('button', { name: m.groups_call_chat_emoji_button() }));
    await waitFor(() => screen.getByTestId('call-emoji-picker'), { timeout: 5000 });
    expect(emojiSets.calls).toBe(1);
  });
});
