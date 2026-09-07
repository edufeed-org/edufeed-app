/**
 * TagSelector Component Tests
 *
 * Verifies the custom-tag input flow: users can add a tag that is not in the
 * popular-15 list by typing it. The handler must trim whitespace, strip a
 * leading `#`, lowercase the result, dedupe, and feed the existing
 * `toggleTag` store update. URL sync is centralized in CalendarView's filter
 * effect (see calendar-url-filter-params.test.js for the codec).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

import TagSelector from '../TagSelector.svelte';
import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';

describe('TagSelector custom tag input', () => {
  beforeEach(() => {
    calendarFilters.reset();
  });

  it('adds a normalized tag when "Add" is clicked', async () => {
    const { getByTestId } = render(TagSelector, { props: { events: [] } });
    const input = /** @type {HTMLInputElement} */ (getByTestId('tag-custom-input'));
    const addBtn = getByTestId('tag-custom-add');

    await fireEvent.input(input, { target: { value: '#FooBar' } });
    await fireEvent.click(addBtn);

    expect(calendarFilters.selectedTags).toEqual(['foobar']);
  });

  it('adds the tag on Enter keypress', async () => {
    const { getByTestId } = render(TagSelector, { props: { events: [] } });
    const input = /** @type {HTMLInputElement} */ (getByTestId('tag-custom-input'));

    await fireEvent.input(input, { target: { value: 'devops' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(calendarFilters.selectedTags).toEqual(['devops']);
  });

  it('is a no-op when the input is empty or whitespace', async () => {
    const { getByTestId } = render(TagSelector, { props: { events: [] } });
    const input = /** @type {HTMLInputElement} */ (getByTestId('tag-custom-input'));
    const addBtn = getByTestId('tag-custom-add');

    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.click(addBtn);

    expect(calendarFilters.selectedTags).toEqual([]);
  });

  it('shows an error and does not duplicate when tag is already selected', async () => {
    calendarFilters.setSelectedTags(['bitcoin']);

    const { getByTestId } = render(TagSelector, { props: { events: [] } });
    const input = /** @type {HTMLInputElement} */ (getByTestId('tag-custom-input'));
    const addBtn = getByTestId('tag-custom-add');

    await fireEvent.input(input, { target: { value: '#Bitcoin' } });
    await fireEvent.click(addBtn);

    expect(calendarFilters.selectedTags).toEqual(['bitcoin']);
    const err = getByTestId('tag-custom-error');
    expect(err.textContent?.length).toBeGreaterThan(0);
  });

  it('renders a chip for the newly-added tag (via selectedNotPopular)', async () => {
    const { getByTestId, container } = render(TagSelector, { props: { events: [] } });
    const input = /** @type {HTMLInputElement} */ (getByTestId('tag-custom-input'));
    const addBtn = getByTestId('tag-custom-add');

    await fireEvent.input(input, { target: { value: 'foobar' } });
    await fireEvent.click(addBtn);

    // The existing template renders displayedTags with `<span class="text-xs opacity-70">#</span>{tag}`.
    // Look for the tag text inside any rendered button.
    const buttons = Array.from(container.querySelectorAll('button'));
    const match = buttons.some((b) => b.textContent?.includes('foobar'));
    expect(match).toBe(true);
  });
});
