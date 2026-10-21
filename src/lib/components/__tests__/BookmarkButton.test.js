/**
 * BookmarkButton Component Tests
 *
 * The bookmark menu is a DaisyUI dropdown. Its horizontal alignment must be
 * configurable: on a detail page the button sits at the left edge of the main
 * column, and an end-aligned menu grows leftwards out of the scroll container,
 * where it gets clipped behind the nav sidebar ("Bookmark abgeschnitten").
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import BookmarkButton from '../bookmarks/BookmarkButton.svelte';

vi.mock('$lib/stores/personal-bookmarks.svelte.js', () => ({
  isBookmarked: () => false,
  isBookmarkedAnywhere: () => false,
  isInBookmarkSet: () => false,
  isBookmarkPending: () => false,
  bookmark: vi.fn(),
  unbookmark: vi.fn(),
  createBookmarkSetAndBookmark: vi.fn(),
  getBookmarkSets: () => [],
  getBookmarkSetTitle: () => '',
  getBookmarkSetIdentifier: () => '',
  getIsLoading: () => false
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: null },
  useActiveUser: () => () => null
}));

vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));

/** @type {import('nostr-tools').NostrEvent} */
const event = {
  id: 'a'.repeat(64),
  kind: 30142,
  pubkey: 'b'.repeat(64),
  created_at: 1700000000,
  tags: [],
  content: '',
  sig: 'c'.repeat(128)
};

/** @param {HTMLElement} container */
function dropdownOf(container) {
  const el = container.querySelector('details.dropdown');
  if (!el) throw new Error('dropdown not rendered');
  return el;
}

describe('BookmarkButton dropdown alignment', () => {
  it('opens end-aligned by default (cards place it at the right edge)', () => {
    const { container } = render(BookmarkButton, { props: { event } });
    const dropdown = dropdownOf(container);
    expect(dropdown.classList.contains('dropdown-end')).toBe(true);
    expect(dropdown.classList.contains('dropdown-start')).toBe(false);
  });

  it('opens start-aligned when align="start" (detail page, left edge of the column)', () => {
    const { container } = render(BookmarkButton, { props: { event, align: 'start' } });
    const dropdown = dropdownOf(container);
    expect(dropdown.classList.contains('dropdown-start')).toBe(true);
    expect(dropdown.classList.contains('dropdown-end')).toBe(false);
  });
});
