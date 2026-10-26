/**
 * DiscoverFilterBar results line: the hidden-calendar-sources fragment
 * ("· N importierte ausgeblendet · anzeigen") belongs to tabs that show
 * calendar events only. On the learning tab it read "0 Ergebnisse · inkl.
 * 244 importierte · ausblenden" next to a resource search (laoc, 2026-10-26).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

vi.mock('$lib/components/feed/CommunityFilterDropdown.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/feed/RelayFilterDropdown.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/calendar/EventDateRangeFilter.svelte', () => ({ default: () => null }));
vi.mock('$lib/components/educational/LearningContentFilters.svelte', () => ({
  default: () => null
}));

import DiscoverFilterBar from '../DiscoverFilterBar.svelte';

/** @param {string} contentType @param {number} resultCount */
function renderBar(contentType, resultCount) {
  return render(DiscoverFilterBar, {
    props: {
      contentType,
      sortBy: 'newest',
      canSortByRelevance: false,
      activeUser: null,
      communityFilter: null,
      communityOptions: { joined: [], discover: [] },
      oncommunitychange: () => {},
      relayCategory: null,
      availableRelays: [],
      relayFilter: null,
      onrelaychange: () => {},
      eventsRange: { start: 0, end: 1 },
      onrangechange: () => {},
      hiddenCalendarCount: 244,
      onlearningfilterchange: () => {},
      learningIsSearching: false,
      searchText: '',
      resultCount,
      hasMore: false
    }
  });
}

describe('DiscoverFilterBar results line', () => {
  it('shows the hidden-sources fragment on the events tab', () => {
    const { queryByTestId } = renderBar('events', 20);
    expect(queryByTestId('hidden-sources-toggle')).not.toBeNull();
  });

  it('shows it on the "all" tab, which merges calendar events', () => {
    const { queryByTestId } = renderBar('all', 20);
    expect(queryByTestId('hidden-sources-toggle')).not.toBeNull();
  });

  it('never shows it on the learning tab, even with zero results', () => {
    const { queryByTestId, container } = renderBar('learning', 0);
    expect(queryByTestId('hidden-sources-toggle')).toBeNull();
    expect(container.textContent).not.toMatch(/importierte|imported/);
  });

  it('keeps the results line reachable at zero results on the events tab (toggle must stay usable)', () => {
    const { queryByTestId } = renderBar('events', 0);
    expect(queryByTestId('hidden-sources-toggle')).not.toBeNull();
  });
});
