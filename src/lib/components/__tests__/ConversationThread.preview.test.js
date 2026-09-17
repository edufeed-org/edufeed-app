/** @vitest-environment jsdom */
/**
 * ConversationThread composer preview — a picked NIP-30 custom emoji sits in
 * the plain text field as `:shortcode:`; only the sent bubble renders the
 * image (laoc, 2026-09-17). The composer must show the image while the
 * shortcode is in the text, and let the writer take it out again.
 * Mock setup mirrors ConversationThread.emoji.test.js (pr/dm-custom-emoji).
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

describe('ConversationThread composer preview', () => {
  beforeEach(() => sendWrappedDm.mockClear());

  it('shows the picked custom emoji as an image while it is in the text, and removes it on request', async () => {
    render(ConversationThread, {
      props: { conversationId: `${ME}:${PEER}`, participants: [ME, PEER] }
    });
    await fireEvent.click(screen.getByTitle('Emoji'));
    await fireEvent.click(await screen.findByTestId('custom-emoji-option'));

    const textarea = /** @type {HTMLTextAreaElement} */ (screen.getByRole('textbox'));
    expect(textarea.value).toBe(':dogedance_sm:');
    const chip = await screen.findByTestId('composer-emoji-chip');
    expect(/** @type {HTMLImageElement} */ (chip.querySelector('img')).getAttribute('src')).toBe(
      DOGE.url
    );

    await fireEvent.click(/** @type {HTMLButtonElement} */ (chip.querySelector('button')));
    await waitFor(() => expect(textarea.value).toBe(''));
    expect(screen.queryByTestId('composer-emoji-chip')).toBeNull();
  });

  it('drops the chip when the writer deletes the shortcode by hand', async () => {
    render(ConversationThread, {
      props: { conversationId: `${ME}:${PEER}`, participants: [ME, PEER] }
    });
    await fireEvent.click(screen.getByTitle('Emoji'));
    await fireEvent.click(await screen.findByTestId('custom-emoji-option'));
    await screen.findByTestId('composer-emoji-chip');

    const textarea = /** @type {HTMLTextAreaElement} */ (screen.getByRole('textbox'));
    await fireEvent.input(textarea, { target: { value: 'kein emoji mehr' } });
    await waitFor(() => expect(screen.queryByTestId('composer-emoji-chip')).toBeNull());
  });
});
