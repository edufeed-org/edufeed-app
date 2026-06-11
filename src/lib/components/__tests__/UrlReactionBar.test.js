// @ts-nocheck
/**
 * UrlReactionBar Component Tests
 *
 * Tests for URL-rooted (NIP-25 kind 17, NIP-73) reactions on a page URL.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import UrlReactionBar from '../reactions/UrlReactionBar.svelte';

const TEST_URL = 'https://example.com/article';

const mockReactionEvents = [
  {
    id: 'r1',
    kind: 17,
    pubkey: 'pubkey-alice',
    content: '🔥',
    created_at: 1700000100,
    tags: [
      ['i', TEST_URL],
      ['k', 'web']
    ]
  },
  {
    id: 'r2',
    kind: 17,
    pubkey: 'pubkey-bob',
    content: '🔥',
    created_at: 1700000200,
    tags: [
      ['i', TEST_URL],
      ['k', 'web']
    ]
  }
];

const activeUserRef = { value: /** @type {any} */ (null) };
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => activeUserRef.value
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    timeline: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    remove$: {
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
    }
  }
}));

const mockPublishReactionForUrl = vi.fn(() => Promise.resolve({ success: true, event: {} }));
vi.mock('$lib/helpers/reactions.js', async () => {
  const normalizeReactionContent = (/** @type {string} */ content) => content || '+';
  const aggregateReactions = (
    /** @type {any[]} */ events,
    /** @type {string | undefined} */ currentUserPubkey
  ) => {
    const agg = new Map();
    for (const reaction of events) {
      const emoji = normalizeReactionContent(reaction.content);
      const existing = agg.get(emoji) || {
        count: 0,
        userReacted: false,
        userReactionEvent: null,
        emojiUrl: null,
        reactors: []
      };
      const isUserReaction = !!currentUserPubkey && reaction.pubkey === currentUserPubkey;
      existing.reactors.push(reaction.pubkey);
      agg.set(emoji, {
        count: existing.count + 1,
        userReacted: existing.userReacted || isUserReaction,
        userReactionEvent: isUserReaction ? reaction : existing.userReactionEvent,
        emojiUrl: null,
        reactors: existing.reactors
      });
    }
    return agg;
  };
  return {
    aggregateReactions,
    normalizeReactionContent,
    publishReactionForUrl: (/** @type {any[]} */ ...args) => mockPublishReactionForUrl(...args)
  };
});

vi.mock('$lib/loaders/reactions.js', () => ({
  reactionsLoaderForUrl: vi.fn(() => () => ({
    subscribe: () => ({ unsubscribe: vi.fn() })
  }))
}));

const mockDeleteEvent = vi.fn(() => Promise.resolve({ success: true }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: (/** @type {any[]} */ ...args) => mockDeleteEvent(...args)
}));

vi.mock('$lib/paraglide/messages', () => ({
  reactions_add_reaction_title: () => 'Add reaction',
  reactions_login_required: () => 'Login required',
  common_close: () => 'Close',
  reactions_picker_title: () => 'Pick a reaction'
}));

// Stub child components
vi.mock('../reactions/ReactionButton.svelte', async () => {
  const mod = await import('./stubs/StubReactionButton.svelte');
  return { default: mod.default };
});
vi.mock('../reactions/AddReactionButton.svelte', async () => {
  const mod = await import('./stubs/StubAddReactionButton.svelte');
  return { default: mod.default };
});

class MockIntersectionObserver {
  /** @param {IntersectionObserverCallback} callback */
  constructor(callback) {
    this.callback = callback;
  }
  root = null;
  rootMargin = '';
  /** @type {number[]} */
  thresholds = [];
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
}
globalThis.IntersectionObserver = /** @type {typeof IntersectionObserver} */ (
  /** @type {unknown} */ (MockIntersectionObserver)
);

describe('UrlReactionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeUserRef.value = null;
  });

  it('renders the bar container with correct test id', () => {
    const { container } = render(UrlReactionBar, {
      props: { url: TEST_URL }
    });
    const bar = container.querySelector('[data-testid="url-reaction-bar"]');
    expect(bar).toBeTruthy();
  });

  it('does not render when url is empty', () => {
    const { container } = render(UrlReactionBar, {
      props: { url: '' }
    });
    const bar = container.querySelector('[data-testid="url-reaction-bar"]');
    expect(bar).toBeFalsy();
  });

  it('subscribes to the eventStore.timeline with kind 17 + #i URL filter', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    render(UrlReactionBar, {
      props: { url: TEST_URL }
    });
    expect(eventStore.timeline).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: [17], '#i': [TEST_URL] })
    );
  });

  it('renders aggregated reaction buttons when events are emitted', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    vi.mocked(eventStore.timeline).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb(mockReactionEvents);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(UrlReactionBar, {
      props: { url: TEST_URL }
    });

    const buttons = container.querySelectorAll('[data-testid="reaction-button"]');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('🔥');
    expect(buttons[0].textContent).toContain('2');
  });

  it('clicking a non-reacted emoji button calls publishReactionForUrl with (url, emoji)', async () => {
    activeUserRef.value = { pubkey: 'pubkey-other', signer: {} };

    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    vi.mocked(eventStore.timeline).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb(mockReactionEvents);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(UrlReactionBar, {
      props: { url: TEST_URL }
    });

    const button = container.querySelector('[data-testid="reaction-button"]');
    expect(button).toBeTruthy();
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    expect(mockPublishReactionForUrl).toHaveBeenCalledWith(TEST_URL, '🔥');
  });

  it("clicking the user's own reaction calls deleteEvent", async () => {
    activeUserRef.value = { pubkey: 'pubkey-alice', signer: {} };

    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
    vi.mocked(eventStore.timeline).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb(mockReactionEvents);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(UrlReactionBar, {
      props: { url: TEST_URL }
    });

    const button = container.querySelector('[data-testid="reaction-button"]');
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    expect(mockDeleteEvent).toHaveBeenCalled();
    expect(mockPublishReactionForUrl).not.toHaveBeenCalled();
  });

  it('renders an add reaction button', () => {
    const { container } = render(UrlReactionBar, {
      props: { url: TEST_URL }
    });
    const addBtn = container.querySelector('[data-testid="add-reaction-btn"]');
    expect(addBtn).toBeTruthy();
  });
});
