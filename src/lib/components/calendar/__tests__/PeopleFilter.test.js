/**
 * PeopleFilter Component Tests
 *
 * Verifies the new search bar inside the People dropdown:
 *   - typing filters the visible avatar grid by display name
 *   - pressing Enter on a parsed npub/hex adds it as a featured-author filter
 *
 * The dropdown uses logged-out (no `manager.active`) so the people pool is
 * the deployment's `featuredAuthors` prop.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

// Mocks need to be hoisted above the component import.
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: null,
    active$: {
      /** @type {(cb: (u: any) => void) => { unsubscribe: () => void }} */
      subscribe: (cb) => {
        cb(null);
        return { unsubscribe: () => {} };
      }
    }
  }
}));

vi.mock('$lib/helpers/followListLoader.js', () => ({
  loadFollowList: vi.fn(async () => null),
  loadFollowSets: vi.fn(async () => [])
}));

const PUBKEY_ALICE = 'a'.repeat(64);
const PUBKEY_BOB = 'b'.repeat(64);
const PUBKEY_NEW = 'c'.repeat(64);
const NPUB_NEW = nip19.npubEncode(PUBKEY_NEW);

const profileMap = new Map([
  [PUBKEY_ALICE, { name: 'Alice', display_name: 'Alice' }],
  [PUBKEY_BOB, { name: 'Bob', display_name: 'Bob' }]
]);

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => profileMap
}));

vi.mock('applesauce-core/helpers', () => ({
  getProfilePicture: () => undefined
}));

import PeopleFilter from '../PeopleFilter.svelte';
import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';

describe('PeopleFilter search bar', () => {
  beforeEach(() => {
    calendarFilters.reset();
  });

  it('renders an avatar button per person in the pool', () => {
    const { container } = render(PeopleFilter, {
      props: { featuredAuthors: [PUBKEY_ALICE, PUBKEY_BOB] }
    });

    const grid = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="people-filter-individual-grid"]')
    );
    expect(grid).toBeTruthy();
    const buttons = grid.querySelectorAll('button');
    expect(buttons.length).toBe(2);
  });

  it('filters the avatar grid by typed display name', async () => {
    const { container } = render(PeopleFilter, {
      props: { featuredAuthors: [PUBKEY_ALICE, PUBKEY_BOB] }
    });

    const searchPanel = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="people-filter-search"]')
    );
    expect(searchPanel).toBeTruthy();
    const input = /** @type {HTMLInputElement} */ (searchPanel.querySelector('input'));

    await fireEvent.input(input, { target: { value: 'ali' } });

    const grid = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="people-filter-individual-grid"]')
    );
    const buttons = grid.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Alice');
  });

  it('shows a "no matches" message when the filter eliminates everyone', async () => {
    const { container, queryByTestId } = render(PeopleFilter, {
      props: { featuredAuthors: [PUBKEY_ALICE, PUBKEY_BOB] }
    });
    const searchPanel = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="people-filter-search"]')
    );
    const input = /** @type {HTMLInputElement} */ (searchPanel.querySelector('input'));

    await fireEvent.input(input, { target: { value: 'zzzzz' } });

    expect(queryByTestId('people-filter-no-matches')).not.toBeNull();
  });

  it('adds a featured author when a valid npub is submitted with Enter', async () => {
    const { container } = render(PeopleFilter, {
      props: { featuredAuthors: [PUBKEY_ALICE] }
    });
    const searchPanel = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="people-filter-search"]')
    );
    const input = /** @type {HTMLInputElement} */ (searchPanel.querySelector('input'));

    await fireEvent.input(input, { target: { value: NPUB_NEW } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(calendarFilters.selectedFeaturedAuthors).toContain(PUBKEY_NEW);
  });

  it('adds a featured author when a 64-char hex is submitted with Enter', async () => {
    const { container } = render(PeopleFilter, {
      props: { featuredAuthors: [] }
    });
    const searchPanel = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="people-filter-search"]')
    );
    const input = /** @type {HTMLInputElement} */ (searchPanel.querySelector('input'));

    await fireEvent.input(input, { target: { value: PUBKEY_NEW } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(calendarFilters.selectedFeaturedAuthors).toEqual([PUBKEY_NEW]);
  });

  it('does not duplicate when the same npub is submitted twice', async () => {
    calendarFilters.setSelectedFeaturedAuthors([PUBKEY_NEW]);

    const { container } = render(PeopleFilter, {
      props: { featuredAuthors: [] }
    });
    const searchPanel = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="people-filter-search"]')
    );
    const input = /** @type {HTMLInputElement} */ (searchPanel.querySelector('input'));

    await fireEvent.input(input, { target: { value: NPUB_NEW } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(calendarFilters.selectedFeaturedAuthors).toEqual([PUBKEY_NEW]);
  });

  it('is a no-op when Enter is pressed on a non-pubkey query', async () => {
    const { container } = render(PeopleFilter, {
      props: { featuredAuthors: [PUBKEY_ALICE, PUBKEY_BOB] }
    });
    const searchPanel = /** @type {HTMLElement} */ (
      container.querySelector('[data-testid="people-filter-search"]')
    );
    const input = /** @type {HTMLInputElement} */ (searchPanel.querySelector('input'));

    await fireEvent.input(input, { target: { value: 'ali' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(calendarFilters.selectedFeaturedAuthors).toEqual([]);
  });
});
