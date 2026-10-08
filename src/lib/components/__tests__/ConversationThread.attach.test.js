/** @vitest-environment jsdom */
/**
 * ConversationThread file sending — issue "allow clipboard pastes to upload
 * images and stuff from clipboard". A file from the 📎 picker, a paste or a
 * drop is encrypted, uploaded, and sent at once as its own NIP-17 kind-15
 * message (a file message carries no text, so the draft is left alone).
 * Legacy NIP-04 threads cannot carry one and say so.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { of } from 'rxjs';
import { tick } from 'svelte';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);

const sendWrappedDm = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const upload = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const INFO = {
  url: 'https://blossom.example/' + 'c'.repeat(64),
  fileType: 'image/png',
  algorithm: 'aes-gcm',
  key: 'ab'.repeat(32),
  nonce: 'cd'.repeat(12),
  hash: 'c'.repeat(64),
  size: 20,
  name: 'shot.png'
};

vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    // The legacy (NIP-04) thread reads a plain kind-4 array, the NIP-17 one a
    // {messages, reactionsByTarget} emission.
    model: (/** @type {any} */ factory) =>
      String(factory?.name).includes('Legacy')
        ? of([])
        : of({ messages: [], reactionsByTarget: new Map() })
  }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME, signer: { getPublicKey: async () => ME } })
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { blossom: { maxFileSize: 1000 } }
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));
vi.mock('$lib/stores/user-emoji-sets.svelte.js', () => ({ useUserEmojiSets: () => () => [] }));
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
vi.mock('$lib/helpers/dm-file-upload.js', () => ({
  uploadEncryptedDmFile: (/** @type {any[]} */ ...a) => upload(...a)
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: (/** @type {any[]} */ ...a) => toast(...a) }));
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
vi.mock(
  '$lib/stores/mention-candidates.svelte.js',
  () => import('./fixtures/mention-candidates-mock.svelte.js')
);

import ConversationThread from '$lib/components/dm/ConversationThread.svelte';
import { SendWrappedFile } from '$lib/actions/dm-actions.js';

const props = { conversationId: `${ME}:${PEER}`, participants: [ME, PEER] };
const png = (size = 10) => new File([new Uint8Array(size)], 'shot.png', { type: 'image/png' });

/** @param {HTMLElement} target @param {File[]} files */
async function paste(target, files) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => '' } });
  target.dispatchEvent(event);
  await tick();
}

beforeEach(() => {
  sendWrappedDm.mockClear();
  upload.mockReset();
  upload.mockResolvedValue(INFO);
  toast.mockClear();
});

describe('ConversationThread file sending', () => {
  it('encrypts, uploads and sends a picked file as a kind-15 message', async () => {
    render(ConversationThread, { props });
    const input = /** @type {HTMLInputElement} */ (screen.getByTestId('dm-attach-input'));
    expect(input.multiple).toBe(true);
    const file = png();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await fireEvent.change(input);
    await waitFor(() => expect(sendWrappedDm).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(file, { signer: expect.anything() });
    expect(sendWrappedDm).toHaveBeenCalledWith([PEER], '', {
      action: SendWrappedFile,
      args: [[ME, PEER], INFO]
    });
  });

  it('sends a pasted file the same way and leaves the draft alone', async () => {
    render(ConversationThread, { props });
    const editor = screen.getByTestId('dm-input');
    await paste(editor, [png()]);
    await waitFor(() => expect(sendWrappedDm).toHaveBeenCalledTimes(1));
    expect(editor.textContent).toBe('');
  });

  it('sends files dropped on the composer, one after another', async () => {
    render(ConversationThread, { props });
    const form = screen.getByTestId('dm-composer-form');
    const a = png();
    const b = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [a, b], types: ['Files'] } });
    form.dispatchEvent(drop);
    await waitFor(() => expect(sendWrappedDm).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls.map((c) => c[0])).toEqual([a, b]);
  });

  it('refuses a file over the Blossom size cap with a toast', async () => {
    render(ConversationThread, { props });
    await paste(screen.getByTestId('dm-input'), [png(5000)]);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(upload).not.toHaveBeenCalled();
    expect(sendWrappedDm).not.toHaveBeenCalled();
  });

  it('reports a failed upload and sends nothing', async () => {
    upload.mockRejectedValueOnce(new Error('server down'));
    render(ConversationThread, { props });
    await paste(screen.getByTestId('dm-input'), [png()]);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(sendWrappedDm).not.toHaveBeenCalled();
  });

  it('offers no file sending in a legacy NIP-04 thread and says why on paste', async () => {
    render(ConversationThread, {
      props: { conversationId: `legacy:${PEER}`, participants: [ME, PEER] }
    });
    expect(screen.queryByTestId('dm-attach-input')).toBeNull();
    await paste(screen.getByTestId('dm-input'), [png()]);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(upload).not.toHaveBeenCalled();
  });
});
