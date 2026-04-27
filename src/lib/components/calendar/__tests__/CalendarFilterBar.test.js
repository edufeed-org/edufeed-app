/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import CalendarFilterBar from '../CalendarFilterBar.svelte';
import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

// Stub child panels to keep the test focused on CalendarFilterBar layout.
vi.mock('../TagSelector.svelte', () => ({ default: () => null }));
vi.mock('../SearchInput.svelte', () => ({ default: () => null }));
vi.mock('../PeopleFilter.svelte', () => ({ default: () => null }));
vi.mock('../AdvancedFiltersDropdown.svelte', () => ({ default: () => null }));
vi.mock('../ActiveFilterChips.svelte', () => ({ default: () => null }));

describe('CalendarFilterBar', () => {
  const baseProps = {
    validEvents: [],
    featuredAuthors: [],
    onRelayFilterChange: () => {},
    onSearchQueryChange: () => {},
    onTagFilterChange: () => {},
    onPeopleChange: () => {},
    onClearAll: () => {}
  };

  beforeEach(() => {
    calendarFilters.reset();
  });

  it('renders a Tags dropdown trigger in the bar', () => {
    const { container } = render(CalendarFilterBar, { props: baseProps });
    // Only the Tags dropdown has a [data-filter-trigger] on its own; the
    // PeopleFilter and AdvancedFiltersDropdown are mocked out here, so we
    // assert the Tags trigger rendered.
    const triggers = container.querySelectorAll('[data-filter-trigger]');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
  });

  it('mounts without throwing on empty featured authors', () => {
    const { container } = render(CalendarFilterBar, { props: baseProps });
    expect(container).toBeTruthy();
  });

  it('mounts with featured authors provided', () => {
    const { container } = render(CalendarFilterBar, {
      props: { ...baseProps, featuredAuthors: ['a'.repeat(64), 'b'.repeat(64)] }
    });
    expect(container).toBeTruthy();
  });
});
