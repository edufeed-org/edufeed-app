/**
 * ActiveFilterChips Component Tests
 *
 * Verifies that removing a chip (or "Clear all") updates BOTH the
 * calendarFilters store AND the URL's query params. The URL-sync side is
 * a regression: chip-remove handlers previously only mutated the store,
 * so the deselected filter stayed in `?tags=…&relays=…&search=…` forever.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const gotoSpy = vi.hoisted(() => vi.fn());

vi.mock('$app/navigation', () => ({ goto: gotoSpy }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ x) => x }));
vi.mock('$app/stores', async () => {
  const { readable: r } = await import('svelte/store');
  return {
    page: r({
      url: new URL(
        'http://localhost/calendar?tags=bitcoin&relays=wss%3A%2F%2Frelay.a.example%2F&search=foo&authors=list-1'
      )
    })
  };
});
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

import ActiveFilterChips from '../ActiveFilterChips.svelte';
import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';

/**
 * Extract the URL passed to goto in the most recent call.
 * @returns {string}
 */
function lastGotoUrl() {
  const calls = gotoSpy.mock.calls;
  if (calls.length === 0) throw new Error('goto was not called');
  return /** @type {string} */ (calls[calls.length - 1][0]);
}

describe('ActiveFilterChips URL sync', () => {
  beforeEach(() => {
    gotoSpy.mockClear();
    calendarFilters.reset();
  });

  it('removes ?tags=… from the URL when the tag chip is clicked', async () => {
    calendarFilters.setSelectedTags(['bitcoin']);

    const { getByTestId } = render(ActiveFilterChips);
    const chip = getByTestId('chip-tag');
    const removeBtn = chip.querySelector('button');
    expect(removeBtn).not.toBeNull();

    await fireEvent.click(/** @type {HTMLElement} */ (removeBtn));

    // Store was updated.
    expect(calendarFilters.selectedTags).toEqual([]);
    // URL was updated — `tags` is gone.
    expect(gotoSpy).toHaveBeenCalled();
    expect(lastGotoUrl()).not.toMatch(/[?&]tags=/);
  });

  it('removes ?relays=… from the URL when the relay chip is clicked', async () => {
    calendarFilters.setSelectedRelays(['wss://relay.a.example/']);

    const { getByTestId } = render(ActiveFilterChips);
    const chip = getByTestId('chip-relay');
    const removeBtn = chip.querySelector('button');
    await fireEvent.click(/** @type {HTMLElement} */ (removeBtn));

    expect(calendarFilters.selectedRelays).toEqual([]);
    expect(gotoSpy).toHaveBeenCalled();
    expect(lastGotoUrl()).not.toMatch(/[?&]relays=/);
  });

  it('removes ?search=… from the URL when the search chip is clicked', async () => {
    calendarFilters.setSearchQuery('foo');

    const { getByTestId } = render(ActiveFilterChips);
    const chip = getByTestId('chip-search');
    const removeBtn = chip.querySelector('button');
    await fireEvent.click(/** @type {HTMLElement} */ (removeBtn));

    expect(calendarFilters.searchQuery).toBe('');
    expect(gotoSpy).toHaveBeenCalled();
    expect(lastGotoUrl()).not.toMatch(/[?&]search=/);
  });

  it('removes ?authors=… from the URL when a follow-list chip is clicked', async () => {
    calendarFilters.setFollowLists([
      { id: 'list-1', name: 'List One', type: 'nip51', pubkeys: [], count: 0 }
    ]);
    calendarFilters.setSelectedFollowListIds(['list-1']);

    const { getByTestId } = render(ActiveFilterChips);
    const chip = getByTestId('chip-list');
    const removeBtn = chip.querySelector('button');
    await fireEvent.click(/** @type {HTMLElement} */ (removeBtn));

    expect(calendarFilters.selectedFollowListIds).toEqual([]);
    expect(gotoSpy).toHaveBeenCalled();
    expect(lastGotoUrl()).not.toMatch(/[?&]authors=/);
  });

  it('clears every URL-mapped param when "Clear all" is clicked', async () => {
    calendarFilters.setSelectedTags(['bitcoin']);
    calendarFilters.setSelectedRelays(['wss://relay.a.example/']);
    calendarFilters.setSearchQuery('foo');
    calendarFilters.setFollowLists([
      { id: 'list-1', name: 'List One', type: 'nip51', pubkeys: [], count: 0 }
    ]);
    calendarFilters.setSelectedFollowListIds(['list-1']);

    const { getByTestId } = render(ActiveFilterChips);
    const clearAll = getByTestId('chip-clear-all');
    await fireEvent.click(clearAll);

    expect(gotoSpy).toHaveBeenCalled();
    const url = lastGotoUrl();
    expect(url).not.toMatch(/[?&]tags=/);
    expect(url).not.toMatch(/[?&]relays=/);
    expect(url).not.toMatch(/[?&]search=/);
    expect(url).not.toMatch(/[?&]authors=/);
  });
});
