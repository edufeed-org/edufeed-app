/**
 * Community chat (kind 9) file attachments — issue "allow clipboard pastes
 * to upload images and stuff from clipboard". The composer takes files from
 * the 📎 picker, a paste and a drop, uploads them to Blossom, puts the URL
 * into the draft, and the sent kind-9 carries a NIP-92 imeta tag for it —
 * the same contract GroupChat has had.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = /** @type {any} */ (
    (/** @type {string} */ query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  );
}

const ME = 'c'.repeat(64);
const COMMUNITY_PUBKEY = 'a'.repeat(64);
const BLOB = 'https://blossom.example/' + 'f'.repeat(64) + '.png';

const signEvent = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ t) => ({ ...t, id: 'x', sig: 'y' }))
);
const upload = vi.hoisted(() => vi.fn());
const publish = vi.hoisted(() => vi.fn());

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    add: vi.fn()
  },
  pool: {
    group: vi.fn(() => ({
      subscription: vi.fn(() => ({
        pipe: vi.fn(() => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }))
      }))
    }))
  }
}));
vi.mock('applesauce-relay/operators', () => ({ storeEvents: () => () => null }));
vi.mock('applesauce-core/models', () => ({ TimelineModel: vi.fn() }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ME, signer: { getPublicKey: async () => ME, signEvent } })
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: [], blossom: { maxFileSize: 10_000_000 } }
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({ getAppRelaysForCategory: () => [] }));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/stores/mention-candidates.svelte.js', () => ({
  useMentionCandidates: () => () => []
}));
vi.mock('$lib/stores/user-emoji-sets.svelte.js', () => ({ useUserEmojiSets: () => () => [] }));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (/** @type {any[]} */ ...a) => publish(...a)
}));
vi.mock('$lib/helpers/chat-attachment-upload.js', () => ({
  uploadChatAttachment: (/** @type {any[]} */ ...a) => upload(...a)
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
function Stub() {}
vi.mock('$lib/components/shared/NostrContentRenderer.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/reactions/ReactionBar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/EmojiPicker.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({ SmilePlusIcon: Stub, SendIcon: Stub, ReplyIcon: Stub }));

const { default: Chat } = await import('$lib/components/community/views/Chat.svelte');

const props = { communikeyEvent: { pubkey: COMMUNITY_PUBKEY }, canPublish: true };
const png = () => new File(['png'], 'shot.png', { type: 'image/png' });

/** @param {HTMLElement} target @param {File[]} files */
async function paste(target, files) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, getData: () => '' } });
  target.dispatchEvent(event);
  await tick();
}

/** @param {HTMLElement} target @param {File[]} files */
async function drop(target, files) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  target.dispatchEvent(event);
  await tick();
}

beforeEach(() => {
  upload.mockReset();
  upload.mockImplementation(async (/** @type {File} */ f) => ({
    url: BLOB,
    type: f.type,
    sha256: 'f'.repeat(64),
    size: f.size,
    name: f.name
  }));
  signEvent.mockClear();
  publish.mockClear();
});

describe('community chat attachments', () => {
  it('uploads a picked file and drops its URL into the draft', async () => {
    const { getByTestId } = render(Chat, { props });
    const input = /** @type {HTMLInputElement} */ (getByTestId('chat-attach-input'));
    expect(input.multiple).toBe(true);
    const file = png();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await fireEvent.change(input);
    await waitFor(() => expect(getByTestId('chat-input').textContent).toContain(BLOB));
    expect(upload).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ signer: expect.anything() })
    );
  });

  it('uploads a pasted file', async () => {
    const { getByTestId } = render(Chat, { props });
    await paste(getByTestId('chat-input'), [png()]);
    await waitFor(() => expect(getByTestId('chat-input').textContent).toContain(BLOB));
  });

  it('uploads a file dropped on the composer', async () => {
    const { getByTestId } = render(Chat, { props });
    await drop(getByTestId('chat-composer-form'), [png()]);
    await waitFor(() => expect(getByTestId('chat-input').textContent).toContain(BLOB));
  });

  it('sends the uploaded file as an imeta tag on the kind-9 message', async () => {
    const { getByTestId } = render(Chat, { props });
    await paste(getByTestId('chat-input'), [png()]);
    await waitFor(() => expect(getByTestId('chat-input').textContent).toContain(BLOB));
    await fireEvent.submit(getByTestId('chat-composer-form'));
    await waitFor(() => expect(signEvent).toHaveBeenCalledTimes(1));
    const event = signEvent.mock.calls[0][0];
    expect(event.kind).toBe(9);
    expect(event.content).toBe(BLOB);
    expect(event.tags).toContainEqual([
      'imeta',
      `url ${BLOB}`,
      'm image/png',
      `x ${'f'.repeat(64)}`,
      'size 3',
      'name shot.png'
    ]);
  });

  it('offers no attach button to someone who cannot publish', () => {
    const { queryByTestId } = render(Chat, { props: { ...props, canPublish: false } });
    expect(queryByTestId('chat-attach-input')).toBeNull();
  });
});
