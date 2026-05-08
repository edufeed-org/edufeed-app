/**
 * Chat.svelte loading-state regression tests.
 *
 * Pins the contract that `isLoading` clears on whichever happens first:
 *   1) the model emits a non-empty events array,
 *   2) the pool subscription emits 'EOSE',
 *   3) a 4s fallback timer fires.
 *
 * The regression that motivated this test: pool.group(...).subscription(...)
 * does not reliably deliver EOSE on a tab-switch resubscribe, so gating the
 * spinner on EOSE alone leaves it stuck even though events are arriving.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

// jsdom doesn't implement matchMedia; some module-load-time code (theme/relay
// settings) calls it. Stub it before any source modules import.
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

// --- Captured per-render state, repopulated in beforeEach ---
/** @type {Function[]} */
let _modelSubscribers;
/** @type {{ next?: Function, error?: Function }[]} */
let _poolHandlers;

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        _modelSubscribers.push(cb);
        // First emission is empty — matches real TimelineModel behavior on a
        // fresh filter with nothing in the store yet. Must not clear the
        // spinner (events.length === 0 path).
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
          subscribe: (/** @type {{ next?: Function, error?: Function }} */ handlers) => {
            _poolHandlers.push(handlers);
            return { unsubscribe: vi.fn() };
          }
        }))
      }))
    }))
  }
}));

// storeEvents is invoked but its result is fed into our mock pipe() which
// ignores its argument — a trivial passthrough satisfies the import.
vi.mock('applesauce-relay/operators', () => ({
  storeEvents: () => () => null
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: vi.fn()
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => null
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

vi.mock('$lib/helpers/message-utils.js', () => ({
  formatMessageTimestamp: () => '12:00',
  getUserDisplayName: () => 'name',
  getReplyParentId: () => null,
  groupMessagesByDate: (/** @type {any[]} */ msgs) =>
    msgs.map((m) => ({ type: 'message', message: m }))
}));

// Stub child components — we don't need their behavior to test isLoading.
function Stub() {}
vi.mock('$lib/components/shared/NostrContentRenderer.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/EmojiPicker.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: Stub }));
vi.mock('$lib/components/icons', () => ({
  SmilePlusIcon: Stub,
  SendIcon: Stub,
  ReplyIcon: Stub
}));

// Paraglide messages — only the keys Chat.svelte calls. Avoids needing the
// generated paraglide bundle in the test environment.
vi.mock('$lib/paraglide/messages', () => ({
  community_views_chat_empty: () => 'No messages',
  community_views_chat_input_placeholder: () => 'Type a message',
  community_views_chat_login_prompt: () => 'Log in to chat',
  // Used transitively by ProfileAvatar/HoverCard if they slip past stubs.
  profile_avatar_fallback: () => '?'
}));

// Imported AFTER the mocks so Chat.svelte resolves them.
const { default: Chat } = await import('$lib/components/community/views/Chat.svelte');

const COMMUNITY_PUBKEY = 'a'.repeat(64);

const fakeMessage = {
  id: 'msg-1',
  kind: 9,
  pubkey: 'b'.repeat(64),
  content: 'hello world',
  created_at: 1_700_000_000,
  tags: [['h', COMMUNITY_PUBKEY]]
};

/** @param {Element} container */
function isSpinnerVisible(container) {
  // The main loading spinner uses `loading-md`; loadMore uses `loading-sm`.
  return !!container.querySelector('.loading-md.loading-spinner');
}

describe('Chat.svelte loading state', () => {
  beforeEach(() => {
    _modelSubscribers = [];
    _poolHandlers = [];
    vi.clearAllMocks();
  });

  it('clears the spinner when the model emits events without EOSE (regression pin)', async () => {
    const { container } = render(Chat, {
      props: { communikeyEvent: { pubkey: COMMUNITY_PUBKEY }, canPublish: false }
    });

    // Pre-condition: subscription wired, spinner visible.
    expect(_modelSubscribers).toHaveLength(1);
    expect(_poolHandlers).toHaveLength(1);
    expect(isSpinnerVisible(container)).toBe(true);

    // Push a non-empty events array through the model. The pool subscription
    // intentionally never emits 'EOSE' — this is the broken-EOSE case the
    // fix has to cover.
    _modelSubscribers[0]([fakeMessage]);
    await Promise.resolve();

    expect(isSpinnerVisible(container)).toBe(false);
  });

  it("clears the spinner on 'EOSE' even when no events arrive", async () => {
    const { container } = render(Chat, {
      props: { communikeyEvent: { pubkey: COMMUNITY_PUBKEY }, canPublish: false }
    });
    expect(isSpinnerVisible(container)).toBe(true);

    _poolHandlers[0].next?.('EOSE');
    await Promise.resolve();

    expect(isSpinnerVisible(container)).toBe(false);
  });

  it('clears the spinner via the 4s fallback timer when nothing else fires', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(Chat, {
        props: { communikeyEvent: { pubkey: COMMUNITY_PUBKEY }, canPublish: false }
      });
      expect(isSpinnerVisible(container)).toBe(true);

      // Just before 4s — still spinning.
      vi.advanceTimersByTime(3_999);
      await Promise.resolve();
      expect(isSpinnerVisible(container)).toBe(true);

      // Crossing the 4s threshold clears it.
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(isSpinnerVisible(container)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
