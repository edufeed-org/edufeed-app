/**
 * Chat.svelte per-message rendering regression tests.
 *
 * Locks in the exact DOM shape of a rendered chat row — avatar mount point,
 * header (name link + timestamp + reply button), bubble (reply-preview +
 * content mount point), and footer (reactions mount point) — BEFORE the
 * message-row markup is extracted into shared `src/lib/components/chat/`
 * components (see DRY refactor: ChannelChat.svelte reused the public
 * community chat's rendering). Chat.test.js already pins the isLoading
 * spinner contract; this file pins the per-message markup contract.
 *
 * Real `getReplyParentId` / `groupMessagesByDate` / `getUserDisplayName` are
 * exercised (only `formatMessageTimestamp` is stubbed for determinism) so
 * this test also protects the reply-resolution and date-grouping behavior
 * that the extraction must preserve.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

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

/** @type {Function[]} */
let _modelSubscribers;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        _modelSubscribers.push(cb);
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    add: vi.fn()
  },
  pool: {
    group: vi.fn(() => ({
      subscription: vi.fn(() => ({
        pipe: vi.fn(() => ({
          subscribe: () => ({ unsubscribe: vi.fn() })
        }))
      }))
    }))
  }
}));

vi.mock('applesauce-relay/operators', () => ({
  storeEvents: () => () => null
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: vi.fn()
}));

const ACTIVE_PUBKEY = 'c'.repeat(64);
const OTHER_PUBKEY = 'a'.repeat(64);
const COMMUNITY_PUBKEY = 'd'.repeat(64);

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: ACTIVE_PUBKEY })
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: [] }
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: () => []
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

vi.mock('$lib/stores/user-emoji-sets.svelte.js', () => ({
  useUserEmojiSets: () => () => []
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn()
}));

vi.mock('$lib/helpers/inbox.js', () => ({
  extractMentionPubkeys: () => []
}));

// Only formatMessageTimestamp is stubbed (for determinism) — getReplyParentId,
// groupMessagesByDate and getUserDisplayName are the REAL implementations.
vi.mock('$lib/helpers/message-utils.js', async () => {
  const actual = /** @type {any} */ (await vi.importActual('$lib/helpers/message-utils.js'));
  return {
    ...actual,
    formatMessageTimestamp: () => '12:00'
  };
});

function Stub() {}
vi.mock('$lib/components/shared/NostrContentRenderer.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/LinkPreviewList.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/reactions/ReactionBar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/EmojiPicker.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({
  SmilePlusIcon: Stub,
  SendIcon: Stub,
  ReplyIcon: Stub
}));

vi.mock('$lib/paraglide/messages', () => ({
  community_views_chat_empty: () => 'No messages',
  community_views_chat_input_placeholder: () => 'Type a message',
  community_views_chat_login_prompt: () => 'Log in to chat',
  profile_avatar_fallback: () => '?'
}));

const { default: Chat } = await import('$lib/components/community/views/Chat.svelte');

const DAY_1 = Math.floor(Date.UTC(2024, 0, 1, 12, 0, 0) / 1000);
const DAY_2 = Math.floor(Date.UTC(2024, 0, 2, 12, 0, 0) / 1000);

const rootMessage = {
  id: 'msg-root',
  kind: 9,
  pubkey: OTHER_PUBKEY,
  content: 'first message',
  created_at: DAY_1,
  tags: [['h', COMMUNITY_PUBKEY]]
};

const replyMessage = {
  id: 'msg-reply',
  kind: 9,
  pubkey: ACTIVE_PUBKEY,
  content: 'reply text',
  created_at: DAY_2,
  tags: [
    ['h', COMMUNITY_PUBKEY],
    ['e', 'msg-root', '', 'reply']
  ]
};

describe('Chat.svelte message row rendering', () => {
  beforeEach(() => {
    _modelSubscribers = [];
    vi.clearAllMocks();
  });

  it('renders a date separator per distinct day, oldest first', async () => {
    const { container } = render(Chat, {
      props: { communikeyEvent: { pubkey: COMMUNITY_PUBKEY }, canPublish: true }
    });
    // Model emits newest-first (matches real TimelineModel ordering).
    _modelSubscribers[0]([replyMessage, rootMessage]);
    await Promise.resolve();

    const dividers = container.querySelectorAll('.divider');
    expect(dividers).toHaveLength(2);
  });

  it('renders the other user row with avatar mount, name link, timestamp and reply button', async () => {
    const { container } = render(Chat, {
      props: { communikeyEvent: { pubkey: COMMUNITY_PUBKEY }, canPublish: true }
    });
    _modelSubscribers[0]([replyMessage, rootMessage]);
    await Promise.resolve();

    const rows = container.querySelectorAll('.chat');
    expect(rows).toHaveLength(2);

    const otherRow = rows[0];
    expect(otherRow.className).toContain('chat-start');

    const nameLink = otherRow.querySelector('.chat-header a.font-semibold');
    expect(nameLink?.textContent?.trim()).toBe(`${OTHER_PUBKEY.slice(0, 8)}...`);

    const time = otherRow.querySelector('.chat-header time');
    expect(time?.textContent?.trim()).toBe('12:00');

    const replyButton = otherRow.querySelector('.chat-header button[title="Reply"]');
    expect(replyButton).toBeTruthy();

    expect(otherRow.querySelector('.chat-bubble')).toBeTruthy();
    expect(otherRow.querySelector('.chat-footer')).toBeTruthy();
  });

  it('renders the own message row without a name link, chat-end + primary bubble, and a reply preview', async () => {
    const { container } = render(Chat, {
      props: { communikeyEvent: { pubkey: COMMUNITY_PUBKEY }, canPublish: true }
    });
    _modelSubscribers[0]([replyMessage, rootMessage]);
    await Promise.resolve();

    const rows = container.querySelectorAll('.chat');
    const ownRow = rows[1];
    expect(ownRow.className).toContain('chat-end');
    expect(ownRow.querySelector('.chat-header a.font-semibold')).toBeNull();

    const bubble = ownRow.querySelector('.chat-bubble');
    expect(bubble?.className).toContain('chat-bubble-primary');

    const replyPreview = ownRow.querySelector('.chat-bubble .border-l-2');
    expect(replyPreview).toBeTruthy();
    expect(replyPreview?.textContent).toContain(`${OTHER_PUBKEY.slice(0, 8)}...`);
    expect(replyPreview?.textContent).toContain('first message');

    // Reply button appears regardless of own/other-ness.
    expect(ownRow.querySelector('.chat-header button[title="Reply"]')).toBeTruthy();
  });
});
