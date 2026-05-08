/**
 * HighlightItem Component Tests
 *
 * Verifies that when expanded, both ReactionBar and CommentList render inline.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import HighlightItem from '../bookmarks/HighlightItem.svelte';

// --- Mocks ---

vi.mock('applesauce-common/helpers', () => ({
  getHighlightText: () => 'highlighted text',
  getHighlightContext: () => 'surrounding context',
  getHighlightComment: () => null
}));

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.name || 'Unknown'
}));

vi.mock('$lib/helpers/calendar.js', () => ({
  formatRelativeTime: () => 'just now'
}));

function StubComponent() {}
vi.mock('../comments/CommentList.svelte', () => ({ default: StubComponent }));
vi.mock('../reactions/ReactionBar.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/EventDeleteButton.svelte', () => ({ default: StubComponent }));
vi.mock('../shared/ProfileAvatar.svelte', () => ({ default: StubComponent }));

const mockEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  kind: 9802,
  created_at: 1700000000,
  tags: [],
  content: 'highlighted text',
  sig: 'c'.repeat(128)
};

describe('HighlightItem', () => {
  describe('when collapsed (expanded=false)', () => {
    it('renders neither ReactionBar nor CommentList', () => {
      const { container } = render(HighlightItem, {
        props: { event: mockEvent, expanded: false }
      });

      expect(container.querySelector('[data-testid="reaction-bar"]')).toBeFalsy();
      expect(container.querySelector('[data-testid="comment-list"]')).toBeFalsy();
    });
  });

  describe('when expanded (expanded=true)', () => {
    it('renders ReactionBar inline', () => {
      const { container } = render(HighlightItem, {
        props: { event: mockEvent, expanded: true }
      });

      expect(container.querySelector('[data-testid="reaction-bar"]')).toBeTruthy();
    });

    it('renders CommentList inline', () => {
      const { container } = render(HighlightItem, {
        props: { event: mockEvent, expanded: true }
      });

      expect(container.querySelector('[data-testid="comment-list"]')).toBeTruthy();
    });
  });
});
