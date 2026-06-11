/**
 * PageNoteItem Component Tests
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
import PageNoteItem from '../bookmarks/PageNoteItem.svelte';

// --- Mocks ---

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.name || 'Unknown'
}));

vi.mock('$lib/helpers/calendar.js', () => ({
  formatRelativeTime: () => 'just now'
}));

vi.mock('$lib/paraglide/messages', () => ({
  comments_add: () => 'Add comment',
  comments_cancel: () => 'Cancel comment'
}));

function StubComponent() {}
vi.mock('../comments/CommentList.svelte', () => ({ default: StubComponent }));
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/EventDeleteButton.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));

vi.mock('$lib/components/icons', () => ({
  ChatIcon: StubComponent
}));

const mockEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 1111,
  created_at: 1700000000,
  tags: [],
  content: 'Note about a page',
  sig: 'c'.repeat(128)
};

describe('PageNoteItem', () => {
  describe('when collapsed (expanded=false)', () => {
    it('renders neither ReactionBar nor CommentList', () => {
      const { container } = render(PageNoteItem, {
        props: { event: mockEvent, expanded: false }
      });

      expect(container.querySelector('[data-testid="reaction-bar"]')).toBeFalsy();
      expect(container.querySelector('[data-testid="comment-list"]')).toBeFalsy();
    });
  });

  describe('when expanded (expanded=true)', () => {
    it('renders ReactionBar inline without user interaction', () => {
      const { container } = render(PageNoteItem, {
        props: { event: mockEvent, expanded: true }
      });

      expect(container.querySelector('[data-testid="reaction-bar"]')).toBeTruthy();
    });

    it('renders CommentList inline without user interaction', () => {
      const { container } = render(PageNoteItem, {
        props: { event: mockEvent, expanded: true }
      });

      expect(container.querySelector('[data-testid="comment-list"]')).toBeTruthy();
    });

    it('does not render the legacy "Add comment" toggle button', () => {
      const { queryByText } = render(PageNoteItem, {
        props: { event: mockEvent, expanded: true }
      });

      expect(queryByText('Add comment')).toBeFalsy();
      expect(queryByText('Cancel comment')).toBeFalsy();
    });
  });
});
