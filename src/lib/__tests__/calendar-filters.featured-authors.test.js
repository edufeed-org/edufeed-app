/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { calendarFilters } from '../stores/calendar-filters.svelte.js';

describe('calendarFilters.selectedFeaturedAuthors', () => {
  beforeEach(() => {
    calendarFilters.clearSelectedFeaturedAuthors();
  });

  it('starts empty', () => {
    expect(calendarFilters.selectedFeaturedAuthors).toEqual([]);
  });

  it('setSelectedFeaturedAuthors replaces the list', () => {
    calendarFilters.setSelectedFeaturedAuthors(['a', 'b']);
    expect(calendarFilters.selectedFeaturedAuthors).toEqual(['a', 'b']);
    calendarFilters.setSelectedFeaturedAuthors(['c']);
    expect(calendarFilters.selectedFeaturedAuthors).toEqual(['c']);
  });

  it('addFeaturedAuthor appends unique entries only', () => {
    calendarFilters.addFeaturedAuthor('a');
    calendarFilters.addFeaturedAuthor('a');
    calendarFilters.addFeaturedAuthor('b');
    expect(calendarFilters.selectedFeaturedAuthors).toEqual(['a', 'b']);
  });

  it('removeFeaturedAuthor drops a single entry', () => {
    calendarFilters.setSelectedFeaturedAuthors(['a', 'b', 'c']);
    calendarFilters.removeFeaturedAuthor('b');
    expect(calendarFilters.selectedFeaturedAuthors).toEqual(['a', 'c']);
  });

  it('clearSelectedFeaturedAuthors empties the list', () => {
    calendarFilters.setSelectedFeaturedAuthors(['a']);
    calendarFilters.clearSelectedFeaturedAuthors();
    expect(calendarFilters.selectedFeaturedAuthors).toEqual([]);
  });

  it('reset() also clears featured authors', () => {
    calendarFilters.setSelectedFeaturedAuthors(['a']);
    calendarFilters.reset();
    expect(calendarFilters.selectedFeaturedAuthors).toEqual([]);
  });
});
