/**
 * BookmarkItem Component Tests
 *
 * Verifies social parity with other detail views:
 * - When expanded, ReactionBar and CommentList both render inline (no toggle).
 * - When collapsed, neither renders.
 * - The legacy "Add comment" toggle button is gone.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import BookmarkItem from '../bookmarks/BookmarkItem.svelte';

// --- Mocks ---

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.name || 'Unknown'
}));

vi.mock('$lib/helpers/calendar.js', () => ({
  formatRelativeTime: () => 'just now'
}));

vi.mock('$lib/helpers/bookmark.js', () => ({
  updateBookmarkContent: vi.fn()
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn()
}));

vi.mock('$lib/paraglide/messages', () => ({
  common_save: () => 'Save',
  common_cancel: () => 'Cancel',
  common_edit: () => 'Edit',
  comments_add: () => 'Add comment',
  comments_cancel: () => 'Cancel comment'
}));

// Stub heavy children — we assert wrapper presence, not their internals.
function StubComponent() {}
vi.mock('../comments/CommentList.svelte', () => ({ default: StubComponent }));
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/EventDeleteButton.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));

vi.mock('$lib/components/icons', () => ({
  ChatIcon: StubComponent,
  EditIcon: StubComponent
}));

const mockEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 39701,
  created_at: 1700000000,
  tags: [['d', 'example.com/path']],
  content: 'A useful resource',
  sig: 'c'.repeat(128)
};

describe('BookmarkItem', () => {
  describe('when collapsed (expanded=false)', () => {
    it('renders neither ReactionBar nor CommentList', () => {
      const { container } = render(BookmarkItem, {
        props: { event: mockEvent, expanded: false }
      });

      expect(container.querySelector('[data-testid="reaction-bar"]')).toBeFalsy();
      expect(container.querySelector('[data-testid="comment-list"]')).toBeFalsy();
    });
  });

  describe('when expanded (expanded=true)', () => {
    it('renders ReactionBar inline without user interaction', () => {
      const { container } = render(BookmarkItem, {
        props: { event: mockEvent, expanded: true }
      });

      expect(container.querySelector('[data-testid="reaction-bar"]')).toBeTruthy();
    });

    it('renders CommentList inline without user interaction', () => {
      const { container } = render(BookmarkItem, {
        props: { event: mockEvent, expanded: true }
      });

      expect(container.querySelector('[data-testid="comment-list"]')).toBeTruthy();
    });

    it('does not render the legacy "Add comment" toggle button', () => {
      const { queryByText } = render(BookmarkItem, {
        props: { event: mockEvent, expanded: true }
      });

      expect(queryByText('Add comment')).toBeFalsy();
      expect(queryByText('Cancel comment')).toBeFalsy();
    });
  });
});
