/**
 * ActiveFilterChips Component Tests
 *
 * Verifies that removing a chip (or "Clear all") updates the calendarFilters
 * store. URL sync is centralized in CalendarView's filter effect (the single
 * writer of filter query params — see calendar-url-filter-params.test.js for
 * the state -> URL codec), so the component's contract is store-only: a chip
 * removal must clear the matching store field, which the effect then mirrors
 * out of the URL.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

import ActiveFilterChips from '../ActiveFilterChips.svelte';
import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';

describe('ActiveFilterChips store sync', () => {
  beforeEach(() => {
    calendarFilters.reset();
  });

  it('clears the tag from the store when the tag chip is clicked', async () => {
    calendarFilters.setSelectedTags(['bitcoin']);

    const { getByTestId } = render(ActiveFilterChips);
    const chip = getByTestId('chip-tag');
    const removeBtn = chip.querySelector('button');
    expect(removeBtn).not.toBeNull();

    await fireEvent.click(/** @type {HTMLElement} */ (removeBtn));

    expect(calendarFilters.selectedTags).toEqual([]);
  });

  it('clears the relay from the store when the relay chip is clicked', async () => {
    calendarFilters.setSelectedRelays(['wss://relay.a.example/']);

    const { getByTestId } = render(ActiveFilterChips);
    const chip = getByTestId('chip-relay');
    const removeBtn = chip.querySelector('button');
    await fireEvent.click(/** @type {HTMLElement} */ (removeBtn));

    expect(calendarFilters.selectedRelays).toEqual([]);
  });

  it('clears the search query when the search chip is clicked', async () => {
    calendarFilters.setSearchQuery('foo');

    const { getByTestId } = render(ActiveFilterChips);
    const chip = getByTestId('chip-search');
    const removeBtn = chip.querySelector('button');
    await fireEvent.click(/** @type {HTMLElement} */ (removeBtn));

    expect(calendarFilters.searchQuery).toBe('');
  });

  it('clears the follow-list selection when a follow-list chip is clicked', async () => {
    calendarFilters.setFollowLists([
      { id: 'list-1', name: 'List One', type: 'nip51', pubkeys: [], count: 0 }
    ]);
    calendarFilters.setSelectedFollowListIds(['list-1']);

    const { getByTestId } = render(ActiveFilterChips);
    const chip = getByTestId('chip-list');
    const removeBtn = chip.querySelector('button');
    await fireEvent.click(/** @type {HTMLElement} */ (removeBtn));

    expect(calendarFilters.selectedFollowListIds).toEqual([]);
  });

  it('clears every filter field when "Clear all" is clicked', async () => {
    calendarFilters.setSelectedTags(['bitcoin']);
    calendarFilters.setSelectedRelays(['wss://relay.a.example/']);
    calendarFilters.setSearchQuery('foo');
    calendarFilters.setFollowLists([
      { id: 'list-1', name: 'List One', type: 'nip51', pubkeys: [], count: 0 }
    ]);
    calendarFilters.setSelectedFollowListIds(['list-1']);
    calendarFilters.setOnlyFollowsMode('follows');
    calendarFilters.setSelectedFeaturedAuthors(['a'.repeat(64)]);

    const { getByTestId } = render(ActiveFilterChips);
    const clearAll = getByTestId('chip-clear-all');
    await fireEvent.click(clearAll);

    expect(calendarFilters.selectedTags).toEqual([]);
    expect(calendarFilters.selectedRelays).toEqual([]);
    expect(calendarFilters.searchQuery).toBe('');
    expect(calendarFilters.selectedFollowListIds).toEqual([]);
    expect(calendarFilters.onlyFollowsMode).toBe('off');
    expect(calendarFilters.selectedFeaturedAuthors).toEqual([]);
  });
});
