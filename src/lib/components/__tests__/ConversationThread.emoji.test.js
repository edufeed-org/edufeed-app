/** @vitest-environment jsdom */
/**
 * ConversationThread — a custom emoji picked in the composer must reach the
 * send action, or the NIP-17 rumor carries no `emoji` tag and the recipient
 * (and our own bubble) shows the literal `:shortcode:` (laoc, 2026-09-16).
 * The community chat already tags kind 9; this locks the DM path in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { of } from 'rxjs';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const DOGE = { shortcode: 'dogedance_sm', url: 'https://example.org/dogedance_sm.gif' };

const sendWrappedDm = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { model: () => of([]) }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME })
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/stores/user-emoji-sets.svelte.js', () => ({
  useUserEmojiSets: () => () => [{ packName: 'Doge', emojis: [DOGE] }]
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunnerOptimistic: { run: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  markConversationAsRead: vi.fn(),
  ensureLegacyMessagesUnlocked: vi.fn().mockResolvedValue(new Set()),
  fetchLegacyConversationHistory: vi.fn()
}));
vi.mock('$lib/services/dm-recipient-relays.js', () => ({
  ensureRecipientDmRelays: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/services/wrapped-dm.js', () => ({ sendWrappedDm }));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
// profileLink's module drags in the loader pool; the header link is not under test.
vi.mock('$lib/helpers/nostrUtils.js', () => ({
  profileLink: (/** @type {string} */ pk) => `/p/${pk}`
}));
vi.mock('$lib/stores/mute-list.svelte.js', () => ({
  getMutedPubkeys: () => new Set(),
  muteUser: vi.fn(),
  unmuteUser: vi.fn()
}));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', async () => {
  const mock = await import('./__mocks__/EmptyStub.svelte');
  return { default: mock.default };
});
vi.mock('$lib/components/shared/NostrContentRenderer.svelte', async () => {
  const mock = await import('./__mocks__/EmptyStub.svelte');
  return { default: mock.default };
});

import ConversationThread from '$lib/components/dm/ConversationThread.svelte';
import { SendWrappedMessage } from '$lib/actions/dm-actions.js';

describe('ConversationThread custom emoji send', () => {
  beforeEach(() => sendWrappedDm.mockClear());

  it('passes the picked custom emoji to the emoji-aware send action', async () => {
    render(ConversationThread, {
      props: { conversationId: `${ME}:${PEER}`, participants: [ME, PEER] }
    });

    await fireEvent.click(screen.getByTitle('Emoji'));
    await fireEvent.click(await screen.findByTestId('custom-emoji-option'));

    const textarea = /** @type {HTMLTextAreaElement} */ (screen.getByRole('textbox'));
    expect(textarea.value).toBe(':dogedance_sm:');

    await fireEvent.submit(/** @type {HTMLFormElement} */ (textarea.closest('form')));

    await waitFor(() => expect(sendWrappedDm).toHaveBeenCalledTimes(1));
    expect(sendWrappedDm).toHaveBeenCalledWith([PEER], ':dogedance_sm:', {
      action: SendWrappedMessage,
      args: [[ME, PEER], ':dogedance_sm:', { emojis: [DOGE] }]
    });
  });
});
