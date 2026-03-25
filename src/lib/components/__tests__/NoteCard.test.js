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
  id: 'note-123',
  kind: 1,
  pubkey: 'author-pubkey-hex-string-64-chars-long-aaaa1111bbbb2222cccc3333',
  tags: [],
  created_at: 1700000000,
  content: 'Hello world'
};

/** @type {Map<string, Function>} */
const modelSubscribers = new Map();

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    reactions: vi.fn(() => ({
      subscribe: (/** @type {Function} */ cb) => {
        cb([]);
        return { unsubscribe: vi.fn() };
      }
    })),
    model: vi.fn((_Model, filter) => {
      const key = JSON.stringify(filter);
      return {
        pipe: () => ({
          subscribe: (/** @type {Function} */ cb) => {
            modelSubscribers.set(key, cb);
            cb([]);
            return { unsubscribe: vi.fn() };
          }
        })
      };
    }),
    remove$: {
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() }))
    }
  },
  pool: {
    request: vi.fn()
  }
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => null
}));

vi.mock('$lib/loaders/reactions.js', () => ({
  reactionsLoader: () => ({
    subscribe: () => ({ unsubscribe: vi.fn() })
  })
}));

vi.mock('$lib/helpers/reactions.js', () => ({
  normalizeReactionContent: (/** @type {string} */ content) => content || '+'
}));

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { gatedMode: false },
  isGatedModeActive: () => false
}));

vi.mock('$lib/loaders/comments.js', () => ({
  createCommentLoaderForEvent: () => () => ({
    subscribe: () => ({ unsubscribe: vi.fn() })
  })
}));

vi.mock('$lib/paraglide/messages', () => ({
  comments_add: () => 'Add Comment',
  comments_cancel: () => 'Cancel',
  comments_show: () => 'Comments',
  comments_hide: () => 'Hide Comments',
  comments_count_one: () => '1 Comment',
  comments_count_other: (/** @type {{ count: number }} */ params) => `${params.count} Comments`
}));

vi.mock('applesauce-core/models', () => ({
  TimelineModel: class TimelineModel {}
}));

vi.mock('rxjs', async () => {
  const actual = await vi.importActual('rxjs');
  return {
    .../** @type {object} */ (actual),
    debounceTime: () => (/** @type {any} */ source) => source
  };
});

// Stub child components that aren't under test
function StubComponent() {}
vi.mock('../reactions/ReactionButton.svelte', () => ({ default: StubComponent }));
vi.mock('../reactions/AddReactionButton.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/NostrContentRenderer.svelte', () => ({ default: StubComponent }));
vi.mock('../comments/CommentList.svelte', () => ({ default: StubComponent }));

describe('NoteCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelSubscribers.clear();
  });

  it('renders the chat button with "Comments" text when no comments', () => {
    const { getByText } = render(NoteCard, {
      props: { note: mockNote }
    });

    expect(getByText('Comments')).toBeTruthy();
  });

  it('does not render CommentList initially', () => {
    const { container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const commentSection = container.querySelector('.border-t.border-base-300');
    expect(commentSection).toBeFalsy();
  });

  it('shows CommentList after clicking the chat button', async () => {
    const { getByText, container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const button = getByText('Comments').closest('button');
    expect(button).toBeTruthy();
    await fireEvent.click(/** @type {HTMLElement} */ (button));

    expect(getByText('Hide Comments')).toBeTruthy();

    const commentSection = container.querySelector('.border-t.border-base-300');
    expect(commentSection).toBeTruthy();
  });

  it('hides CommentList when clicking the chat button again', async () => {
    const { getByText, container } = render(NoteCard, {
      props: { note: mockNote }
    });

    const button = getByText('Comments').closest('button');
    await fireEvent.click(/** @type {HTMLElement} */ (button));
    expect(getByText('Hide Comments')).toBeTruthy();

    // Click again to hide
    await fireEvent.click(/** @type {HTMLElement} */ (button));
    expect(getByText('Comments')).toBeTruthy();

    const commentSection = container.querySelector('.border-t.border-base-300');
    expect(commentSection).toBeFalsy();
  });

  it('highlights the chat button when comments are shown', async () => {
    const { getByText } = render(NoteCard, {
      props: { note: mockNote }
    });

    const button = getByText('Comments').closest('button');
    expect(button?.classList.contains('text-primary')).toBe(false);

    await fireEvent.click(/** @type {HTMLElement} */ (button));
    expect(button?.classList.contains('text-primary')).toBe(true);
  });

  it('shows comment count when comments exist in EventStore', async () => {
    const nip22Key = JSON.stringify({ kinds: [1111], '#E': ['note-123'] });
    const { getByText } = render(NoteCard, {
      props: { note: mockNote }
    });

    const nip22Cb = /** @type {Function} */ (modelSubscribers.get(nip22Key));
    expect(nip22Cb).toBeTruthy();
    nip22Cb([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    await tick();

    await waitFor(() => {
      expect(getByText('3 Comments')).toBeTruthy();
    });
  });

  it('shows singular label for exactly one comment', async () => {
    const nip22Key = JSON.stringify({ kinds: [1111], '#E': ['note-123'] });
    const { getByText } = render(NoteCard, {
      props: { note: mockNote }
    });

    const nip22Cb = /** @type {Function} */ (modelSubscribers.get(nip22Key));
    expect(nip22Cb).toBeTruthy();
    nip22Cb([{ id: 'c1' }]);
    await tick();

    await waitFor(() => {
      expect(getByText('1 Comment')).toBeTruthy();
    });
  });
});
