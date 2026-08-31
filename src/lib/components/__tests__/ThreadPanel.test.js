/**
 * ThreadPanel — NIP-22 thread view for one Concord channel message.
 *
 * Asserts the panel's wiring: kind-1111 comments from the channel store are
 * filtered to the root's thread (oldest first), and the composer publishes
 * through community.sendEvent with the exact Armada-parity tag layout
 * (buildV2CommentTags shape — K/E/P root + k/e/p parent, all rumor ids).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { of } from 'rxjs';

const ACTIVE_PUBKEY = 'c'.repeat(64);
const ROOT_AUTHOR = 'a'.repeat(64);

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ACTIVE_PUBKEY })
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));
vi.mock('$lib/helpers/message-utils.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/helpers/message-utils.js'));
  return { ...actual, formatMessageTimestamp: () => '12:00' };
});

function Stub() {}
vi.mock(
  '$lib/components/shared/NostrContentRenderer.svelte',
  () => import('./fixtures/NostrContentStub.svelte')
);
vi.mock('$lib/components/shared/LinkPreviewList.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({ ReplyIcon: Stub }));
vi.mock(
  '$lib/components/community/channels/MessageAttachments.svelte',
  () => import('./fixtures/MessageAttachmentsStub.svelte')
);

vi.mock('$lib/paraglide/messages', () => ({
  chat_thread_expand: () => 'Expand',
  chat_thread_collapse: () => 'Collapse',
  concord_thread_title: () => 'Thread',
  concord_thread_close: () => 'Close thread',
  concord_thread_replies: (/** @type {{ count: number }} */ { count }) => `${count} replies`,
  concord_thread_reply_placeholder: () => 'Reply in thread…',
  concord_thread_send: () => 'Send',
  concord_send_failed: () => 'Send failed'
}));

const { default: ThreadPanel } = await import(
  '$lib/components/community/channels/ThreadPanel.svelte'
);

const CHANNEL = { channel_id: 'chan-1', name: 'general', private: true };

const root = {
  id: 'root-1',
  kind: 9,
  pubkey: ROOT_AUTHOR,
  content: 'root message',
  created_at: 1000,
  tags: []
};

/** @param {string} id @param {string} rootId @param {number} created_at */
function makeComment(id, rootId, created_at) {
  return {
    id,
    kind: 1111,
    pubkey: ROOT_AUTHOR,
    content: `reply ${id}`,
    created_at,
    tags: [
      ['K', '9'],
      ['E', rootId, '', ROOT_AUTHOR],
      ['P', ROOT_AUTHOR],
      ['k', '9'],
      ['e', rootId, '', ROOT_AUTHOR],
      ['p', ROOT_AUTHOR]
    ]
  };
}

/** @param {any[]} comments @param {any} [sendEvent] */
function makeCommunity(comments, sendEvent = vi.fn().mockResolvedValue('rumor-id')) {
  return {
    channelStore: () => ({
      timeline: (/** @type {any[]} */ filters) => {
        expect(filters).toEqual([{ kinds: [1111] }]); // the panel must ask for comments only
        return of(comments);
      }
    }),
    sendEvent
  };
}

describe('ThreadPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the root message plus only ITS replies, oldest first', async () => {
    const comments = [
      makeComment('c-late', 'root-1', 1005),
      makeComment('c-early', 'root-1', 1001),
      makeComment('c-foreign', 'root-2', 1002) // different thread — must not render
    ];
    const { container } = render(ThreadPanel, {
      props: {
        community: makeCommunity(comments),
        channel: CHANNEL,
        root,
        onClose: () => {}
      }
    });
    await Promise.resolve();

    const contents = [...container.querySelectorAll('[data-testid="ncr-content"]')].map(
      (el) => el.textContent
    );
    expect(contents).toEqual(['root message', 'reply c-early', 'reply c-late']);
    expect(screen.getByText('2 replies')).toBeTruthy();
  });

  it('sends a reply through community.sendEvent with Armada-parity NIP-22 tags', async () => {
    const sendEvent = vi.fn().mockResolvedValue('rumor-id');
    render(ThreadPanel, {
      props: {
        community: makeCommunity([], sendEvent),
        channel: CHANNEL,
        root,
        onClose: () => {}
      }
    });
    await Promise.resolve();

    const input = screen.getByPlaceholderText('Reply in thread…');
    await fireEvent.input(input, { target: { value: 'hello thread' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await Promise.resolve();

    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [channelId, template] = sendEvent.mock.calls[0];
    expect(channelId).toBe('chan-1');
    expect(template.kind).toBe(1111);
    expect(template.content).toBe('hello thread');
    expect(template.tags).toEqual([
      ['K', '9'],
      ['E', 'root-1', '', ROOT_AUTHOR],
      ['P', ROOT_AUTHOR],
      ['k', '9'],
      ['e', 'root-1', '', ROOT_AUTHOR],
      ['p', ROOT_AUTHOR]
    ]);
  });

  it('hides the composer when readOnly (dissolved community)', async () => {
    render(ThreadPanel, {
      props: {
        community: makeCommunity([]),
        channel: CHANNEL,
        root,
        readOnly: true,
        onClose: () => {}
      }
    });
    await Promise.resolve();
    expect(screen.queryByPlaceholderText('Reply in thread…')).toBeNull();
  });

  it('invokes onClose from the header button', async () => {
    const onClose = vi.fn();
    render(ThreadPanel, {
      props: { community: makeCommunity([]), channel: CHANNEL, root, onClose }
    });
    await fireEvent.click(screen.getByTitle('Close thread'));
    expect(onClose).toHaveBeenCalled();
  });
});
