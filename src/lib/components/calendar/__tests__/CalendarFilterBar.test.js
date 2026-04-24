/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import CalendarFilterBar from '../CalendarFilterBar.svelte';

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

// Stub child selectors to keep the test focused on CalendarFilterBar wiring
vi.mock('../RelaySelector.svelte', () => ({
  default: () => null
}));
vi.mock('../FollowListSelector.svelte', () => ({
  default: () => null
}));
vi.mock('../TagSelector.svelte', () => ({
  default: () => null
}));

describe('CalendarFilterBar', () => {
  const baseProps = {
    validEvents: [],
    featuredAuthors: [],
    selectedAuthors: [],
    selectedTagsCount: 0,
    selectedRelaysCount: 0,
    selectedFollowListsCount: 0,
    searchQuery: '',
    eventCount: 0,
    onRelayFilterChange: () => {},
    onFollowListFilterChange: () => {},
    onSearchQueryChange: () => {},
    onTagFilterChange: () => {},
    onAuthorsChange: () => {},
    onClearAll: () => {}
  };

  it('renders four dropdown triggers when featuredAuthors is empty', () => {
    const { container } = render(CalendarFilterBar, { props: baseProps });
    expect(container.querySelectorAll('[data-filter-trigger]').length).toBe(4);
  });

  it('renders five dropdown triggers when featuredAuthors is non-empty', () => {
    const { container } = render(CalendarFilterBar, {
      props: { ...baseProps, featuredAuthors: ['a'.repeat(64), 'b'.repeat(64)] }
    });
    expect(container.querySelectorAll('[data-filter-trigger]').length).toBe(5);
  });

  it('shows count badges on triggers with active filters', () => {
    const { container } = render(CalendarFilterBar, {
      props: {
        ...baseProps,
        featuredAuthors: ['a'.repeat(64)],
        selectedAuthors: ['a'.repeat(64)],
        selectedTagsCount: 2,
        selectedRelaysCount: 1
      }
    });
    const badges = Array.from(
      container.querySelectorAll('[data-filter-trigger] [data-filter-count]')
    ).map((el) => el.textContent?.trim());
    expect(badges).toEqual(expect.arrayContaining(['2', '1', '1']));
  });

  it('shows "Filter zurücksetzen" when any filter is active', () => {
    const { queryByText } = render(CalendarFilterBar, {
      props: { ...baseProps, selectedTagsCount: 1 }
    });
    expect(queryByText('Filter zurücksetzen')).not.toBeNull();
  });

  it('hides "Filter zurücksetzen" when no filters are active', () => {
    const { queryByText } = render(CalendarFilterBar, { props: baseProps });
    expect(queryByText('Filter zurücksetzen')).toBeNull();
  });

  it('calls onClearAll when reset link is clicked', async () => {
    const onClearAll = vi.fn();
    const { getByText } = render(CalendarFilterBar, {
      props: { ...baseProps, selectedTagsCount: 1, onClearAll }
    });
    getByText('Filter zurücksetzen').click();
    expect(onClearAll).toHaveBeenCalledOnce();
  });
});
