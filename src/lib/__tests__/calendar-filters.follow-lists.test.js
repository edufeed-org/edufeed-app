/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { calendarFilters } from '../stores/calendar-filters.svelte.js';

describe('calendarFilters.getSelectedAuthors()', () => {
  beforeEach(() => {
    calendarFilters.clearSelectedFollowListIds();
    calendarFilters.clearFollowLists();
  });

  it('returns [] when no follow lists are selected', () => {
    calendarFilters.setFollowLists([
      { id: 'L1', name: 'List 1', type: 'nip51', pubkeys: ['a', 'b'], count: 2 }
    ]);
    expect(calendarFilters.getSelectedAuthors()).toEqual([]);
  });

  it('returns the pubkeys of the single selected list', () => {
    calendarFilters.setFollowLists([
      { id: 'L1', name: 'List 1', type: 'nip51', pubkeys: ['a', 'b'], count: 2 }
    ]);
    calendarFilters.setSelectedFollowListIds(['L1']);
    const authors = calendarFilters.getSelectedAuthors();
    expect([...authors].sort()).toEqual(['a', 'b']);
  });

  it('deduplicates pubkeys across multiple selected lists', () => {
    calendarFilters.setFollowLists([
      { id: 'L1', name: 'List 1', type: 'nip51', pubkeys: ['a', 'b'], count: 2 },
      { id: 'L2', name: 'List 2', type: 'nip51', pubkeys: ['b', 'c'], count: 2 }
    ]);
    calendarFilters.setSelectedFollowListIds(['L1', 'L2']);
    const authors = calendarFilters.getSelectedAuthors();
    expect([...authors].sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores unknown list ids', () => {
    calendarFilters.setFollowLists([
      { id: 'L1', name: 'List 1', type: 'nip51', pubkeys: ['a'], count: 1 }
    ]);
    calendarFilters.setSelectedFollowListIds(['L1', 'missing']);
    expect(calendarFilters.getSelectedAuthors()).toEqual(['a']);
  });
});
