/**
 * ReactionBar Component Tests
 *
 * Regression tests for the infinite loop bug (effect_update_depth_exceeded)
 * caused by $state() on subscription variables inside $effect callbacks.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import ReactionBar from '../reactions/ReactionBar.svelte';

// --- Mocks ---

const mockEvent = {
  id: 'event-123',
  kind: 1,
  pubkey: 'author-pubkey-hex-string-64-chars-long-aaaa1111bbbb2222cccc3333',
  tags: [],
  created_at: 1700000000,
  content: 'Hello world'
};

const mockReactionEvents = [
  {
    id: 'reaction-1',
    kind: 7,
    pubkey: 'reactor-pubkey-1-aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666',
    tags: [['e', 'event-123']],
    created_at: 1700000100,
    content: '+'
  },
  {
    id: 'reaction-2',
    kind: 7,
    pubkey: 'reactor-pubkey-2-aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666',
    tags: [['e', 'event-123']],
    created_at: 1700000200,
    content: '+'
  }
];

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => null
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    reactions: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        // Emit synchronously (this triggers the infinite loop bug with $state subscriptions)
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    remove$: {
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
    }
  }
}));

vi.mock('$lib/loaders/reactions.js', () => ({
  reactionsLoader: vi.fn(() => ({
    subscribe: () => ({ unsubscribe: vi.fn() })
  }))
}));

vi.mock('$lib/helpers/reactions.js', () => ({
  normalizeReactionContent: (/** @type {string} */ content) => content || '+',
  getCustomEmojiUrl: (/** @type {any} */ event) => {
    const content = event.content?.trim();
    if (!content) return null;
    const match = content.match(/^:([^:]+):$/);
    if (!match) return null;
    const shortcode = match[1];
    const emojiTag = event.tags?.find(
      (/** @type {string[]} */ t) => t[0] === 'emoji' && t[1] === shortcode
    );
    return emojiTag?.[2] || null;
  }
}));

// Stub child components
function StubComponent() {}
vi.mock('../reactions/ReactionButton.svelte', () => ({ default: StubComponent }));
vi.mock('../reactions/AddReactionButton.svelte', () => ({ default: StubComponent }));

// Mock IntersectionObserver for jsdom
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
class MockIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe = mockObserve;
  disconnect = mockDisconnect;
  unobserve = vi.fn();
}
globalThis.IntersectionObserver = MockIntersectionObserver;

describe('ReactionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without effect_update_depth_exceeded on synchronous emission', () => {
    // This test would fail with $state() subscription variables:
    // assigning to $state inside $effect triggers re-run → infinite loop
    const { container } = render(ReactionBar, {
      props: {
        event: mockEvent,
        relays: ['wss://relay.test.com']
      }
    });

    const reactionBar = container.querySelector('[data-testid="reaction-bar"]');
    expect(reactionBar).toBeTruthy();
  });

  it('renders reactions when model emits reaction events synchronously', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    let emissionCount = 0;
    vi.mocked(eventStore.reactions).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            emissionCount++;
            // Emit synchronously with reaction events (triggered the bug)
            cb(mockReactionEvents);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(ReactionBar, {
      props: {
        event: mockEvent,
        relays: ['wss://relay.test.com']
      }
    });

    // Should render without hitting effect depth limit
    const reactionBar = container.querySelector('[data-testid="reaction-bar"]');
    expect(reactionBar).toBeTruthy();
    // Model subscription should only happen once (no re-runs from reactive cycle)
    expect(emissionCount).toBe(1);
  });

  it('renders without crashing when reactions include custom emoji', async () => {
    const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

    const customEmojiReaction = {
      id: 'reaction-custom',
      kind: 7,
      pubkey: 'reactor-pubkey-3-aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666',
      tags: [
        ['e', 'event-123'],
        ['emoji', 'zap', 'https://example.com/zap.png']
      ],
      created_at: 1700000300,
      content: ':zap:'
    };

    vi.mocked(eventStore.reactions).mockImplementation(
      () =>
        /** @type {any} */ ({
          subscribe: (/** @type {Function} */ cb) => {
            cb([...mockReactionEvents, customEmojiReaction]);
            return { unsubscribe: vi.fn() };
          }
        })
    );

    const { container } = render(ReactionBar, {
      props: {
        event: mockEvent,
        relays: ['wss://relay.test.com']
      }
    });

    const reactionBar = container.querySelector('[data-testid="reaction-bar"]');
    expect(reactionBar).toBeTruthy();
  });

  it('does not render when event has no id', () => {
    const { container } = render(ReactionBar, {
      props: {
        event: { ...mockEvent, id: undefined },
        relays: []
      }
    });

    const reactionBar = container.querySelector('[data-testid="reaction-bar"]');
    expect(reactionBar).toBeFalsy();
  });

  describe('lazy prop', () => {
    it('does not call reactionsLoader on mount when lazy=true', async () => {
      const { reactionsLoader } = await import('$lib/loaders/reactions.js');

      render(ReactionBar, {
        props: { event: mockEvent, relays: ['wss://relay.test.com'], lazy: true }
      });

      // Even after the 200ms defer window, lazy should not have called the loader
      await new Promise((r) => setTimeout(r, 300));
      expect(reactionsLoader).not.toHaveBeenCalled();
    });

    it('still shows cached reactions when lazy=true', async () => {
      const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');

      vi.mocked(eventStore.reactions).mockImplementation(
        () =>
          /** @type {any} */ ({
            subscribe: (/** @type {Function} */ cb) => {
              cb(mockReactionEvents);
              return { unsubscribe: vi.fn() };
            }
          })
      );

      const { container } = render(ReactionBar, {
        props: { event: mockEvent, relays: ['wss://relay.test.com'], lazy: true }
      });

      const reactionBar = container.querySelector('[data-testid="reaction-bar"]');
      expect(reactionBar).toBeTruthy();
    });

    it('calls reactionsLoader with 200ms defer when lazy=false (default)', async () => {
      const { reactionsLoader } = await import('$lib/loaders/reactions.js');

      render(ReactionBar, {
        props: { event: mockEvent, relays: ['wss://relay.test.com'] }
      });

      // Not called immediately
      expect(reactionsLoader).not.toHaveBeenCalled();

      // Called after 200ms defer
      await new Promise((r) => setTimeout(r, 250));
      expect(reactionsLoader).toHaveBeenCalledWith(mockEvent, ['wss://relay.test.com']);
    });
  });
});
