/**
 * NoteCard Component Tests
 *
 * Tests for the comment toggle functionality on NoteCard.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import NoteCard from '../notes/NoteCard.svelte';

// --- Mocks ---

const mockNote = {
  // Valid 64-char hex so nip19.neventEncode works in the card-click handler
  id: 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8',
  kind: 1,
  pubkey: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  tags: [],
  created_at: 1700000000,
  content: 'Hello world'
};

/** @type {Function | null} */
let repliesModelSubscriber = null;

const mockGoto = vi.fn();
vi.mock('$app/navigation', () => ({
  goto: (/** @type {any[]} */ ...args) => mockGoto(...args)
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    reactions: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    model: vi.fn((_Model, _event) => ({
      subscribe: (/** @type {Function} */ cb) => {
        repliesModelSubscriber = cb;
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    remove$: {
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
    }
  },
  pool: {
    request: vi.fn()
  }
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => null,
  manager: {
    active: null,
    active$: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
    signer: {}
  }
}));

vi.mock('$lib/stores/personal-bookmarks.svelte.js', () => ({
  isBookmarked: () => false,
  bookmark: vi.fn(),
  unbookmark: vi.fn(),
  getIsLoading: () => false
}));

vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: vi.fn() }
}));

vi.mock('$lib/loaders/reactions.js', () => ({
  reactionsLoader: () => ({
    subscribe: () => ({ unsubscribe: vi.fn() })
  })
}));

vi.mock('$lib/helpers/reactions.js', () => {
  const normalizeReactionContent = (/** @type {string} */ content) => content || '+';
  // Minimal aggregateReactions for ReactionBar (used inside NoteCard).
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
        emojiUrl: existing.emojiUrl || null,
        reactors: existing.reactors
      });
    }
    return agg;
  };
  return { normalizeReactionContent, aggregateReactions };
});

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { gatedMode: false },
  isGatedModeActive: () => false
}));

vi.mock('$lib/loaders/comments.js', () => ({
  createCommentLoaderForEvent: () => () => ({
    subscribe: () => ({ unsubscribe: vi.fn() })
  })
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => null
}));

vi.mock('$lib/paraglide/messages', () => ({
  comments_add: () => 'Add Comment',
  comments_cancel: () => 'Cancel',
  comments_show: () => 'Comments',
  comments_hide: () => 'Hide Comments',
  comments_count_one: () => '1 Comment',
  comments_count_other: (/** @type {{ count: number }} */ params) => `${params.count} Comments`,
  profile_avatar_alt: () => 'Avatar',
  profile_avatar_fallback: () => '?',
  bookmark_toast_saved: () => 'Bookmarked',
  bookmark_toast_removed: () => 'Bookmark removed',
  bookmark_toast_error: () => 'Failed to bookmark',
  bookmark_toast_login_required: () => 'Sign in to bookmark'
}));

vi.mock('$lib/helpers/toast.js', () => ({
  showToast: vi.fn()
}));

vi.mock('applesauce-common/models', () => ({
  RepliesModel: class RepliesModel {}
}));

// Stub child components that aren't under test
function StubComponent() {}
vi.mock('../reactions/ReactionButton.svelte', () => ({ default: StubComponent }));
vi.mock('../reactions/AddReactionButton.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/NostrContentRenderer.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));
// CommentList stub renders a real textarea so click-bubbling can be tested
vi.mock('../comments/CommentList.svelte', async () => ({
  default: (await import('./fixtures/CommentListStub.svelte')).default
}));
vi.mock('../bookmarks/BookmarkButton.svelte', () => ({ default: StubComponent }));

describe('NoteCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repliesModelSubscriber = null;
  });

  it('renders the chat button', () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    // Comment toggle button should exist (icon-only when no comments)
    const chatButton = container.querySelector('.btn-ghost');
    expect(chatButton).toBeTruthy();
  });

  it('labels the comment toggle as comments, not "Chat" (issue #44)', () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const button = container.querySelector('.btn-ghost');
    const iconTitle = button?.querySelector('svg title');
    // The ChatIcon default title "Chat" renders a misleading native tooltip —
    // the button opens the comments section.
    expect(iconTitle?.textContent).not.toBe('Chat');
    expect(iconTitle?.textContent).toBe('Comments');
  });

  it('does not render CommentList initially', () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    // The actions toolbar also has `.border-t.border-base-300`; the comment wrapper
    // is distinguished by its top margin (`.mt-3`).
    const commentSection = container.querySelector('.mt-3.border-t.border-base-300');
    expect(commentSection).toBeFalsy();
  });

  it('shows CommentList after clicking the chat button', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    // Find the first btn-ghost (comment toggle)
    const button = container.querySelector('.btn-ghost');
    expect(button).toBeTruthy();
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    const commentSection = container.querySelector('.mt-3.border-t.border-base-300');
    expect(commentSection).toBeTruthy();
  });

  it('hides CommentList when clicking the chat button again', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const button = container.querySelector('.btn-ghost');
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    const commentSection = container.querySelector('.mt-3.border-t.border-base-300');
    expect(commentSection).toBeTruthy();

    // Click again to hide
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    const commentSectionAfter = container.querySelector('.mt-3.border-t.border-base-300');
    expect(commentSectionAfter).toBeFalsy();
  });

  it('highlights the chat button when comments are shown', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const button = container.querySelector('.btn-ghost');
    expect(button?.classList.contains('text-primary')).toBe(false);

    await fireEvent.click(/** @type {HTMLElement} */ (button));
    expect(button?.classList.contains('text-primary')).toBe(true);
  });

  it('shows comment count when comments exist in EventStore', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    expect(repliesModelSubscriber).toBeTruthy();
    /** @type {Function} */ (repliesModelSubscriber)([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    await tick();

    await waitFor(() => {
      const button = container.querySelector('.btn-ghost');
      expect(button?.textContent).toContain('3');
    });
  });

  it('does not navigate when clicking into the comment textarea', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    // Open the comment section
    const button = container.querySelector('.btn-ghost');
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    const textarea = container.querySelector('[data-testid="comment-textarea"]');
    expect(textarea).toBeTruthy();

    await fireEvent.click(/** @type {HTMLElement} */ (textarea));
    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('does not navigate when clicking elsewhere inside the comment section', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const button = container.querySelector('.btn-ghost');
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    const commentSection = container.querySelector('.mt-3.border-t.border-base-300');
    expect(commentSection).toBeTruthy();

    await fireEvent.click(/** @type {HTMLElement} */ (commentSection));
    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('does not navigate when typing Space or Enter in the comment textarea', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const button = container.querySelector('.btn-ghost');
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    const textarea = container.querySelector('[data-testid="comment-textarea"]');
    expect(textarea).toBeTruthy();

    await fireEvent.keyDown(/** @type {HTMLElement} */ (textarea), { key: ' ' });
    await fireEvent.keyDown(/** @type {HTMLElement} */ (textarea), { key: 'Enter' });
    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('navigates to the note view when clicking the card body', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const card = container.querySelector('[role="button"]');
    expect(card).toBeTruthy();

    await fireEvent.click(/** @type {HTMLElement} */ (card));
    expect(mockGoto).toHaveBeenCalledTimes(1);
  });

  it('shows count for exactly one comment', async () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    expect(repliesModelSubscriber).toBeTruthy();
    /** @type {Function} */ (repliesModelSubscriber)([{ id: 'c1' }]);
    await tick();

    await waitFor(() => {
      const button = container.querySelector('.btn-ghost');
      expect(button?.textContent).toContain('1');
    });
  });
});
