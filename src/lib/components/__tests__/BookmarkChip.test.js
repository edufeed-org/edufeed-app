/**
 * BookmarkChip Component Tests
 *
 * Verifies the chip can act as a clickable trigger so reader view can
 * surface the per-bookmark ReactionBar + CommentList panel.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BookmarkChip from '../bookmarks/BookmarkChip.svelte';

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.name || 'Unknown',
  getProfilePicture: () => null
}));

vi.mock('$lib/helpers/calendar.js', () => ({
  formatCalendarDate: () => '2024-01-01'
}));

function StubComponent() {}
vi.mock('../shared/ImageWithFallback.svelte', () => ({ default: StubComponent }));

const mockProfile = { name: 'Alice' };

describe('BookmarkChip', () => {
  it('renders the display name and date', () => {
    const { getByText } = render(BookmarkChip, {
      props: { profile: mockProfile, timestamp: 1700000000 }
    });
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('2024-01-01')).toBeTruthy();
  });

  it('is non-interactive by default (no onclick prop)', () => {
    const { container } = render(BookmarkChip, {
      props: { profile: mockProfile, timestamp: 1700000000 }
    });
    const root = container.firstElementChild;
    expect(root?.getAttribute('role')).not.toBe('button');
  });

  it('becomes a button when onclick is provided', () => {
    const onclick = vi.fn();
    const { container } = render(BookmarkChip, {
      props: { profile: mockProfile, timestamp: 1700000000, onclick }
    });
    const root = container.firstElementChild;
    expect(root?.getAttribute('role')).toBe('button');
  });

  it('fires onclick when clicked', async () => {
    const onclick = vi.fn();
    const { container } = render(BookmarkChip, {
      props: { profile: mockProfile, timestamp: 1700000000, onclick }
    });
    const root = /** @type {HTMLElement} */ (container.firstElementChild);
    await fireEvent.click(root);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('applies an active marker class when active=true', () => {
    const { container } = render(BookmarkChip, {
      props: { profile: mockProfile, timestamp: 1700000000, onclick: () => {}, active: true }
    });
    const root = /** @type {HTMLElement} */ (container.firstElementChild);
    expect(root.className).toMatch(/ring/);
  });

  it('does not apply the active marker when active=false', () => {
    const { container } = render(BookmarkChip, {
      props: { profile: mockProfile, timestamp: 1700000000, onclick: () => {}, active: false }
    });
    const root = /** @type {HTMLElement} */ (container.firstElementChild);
    expect(root.className).not.toMatch(/ring/);
  });
});
