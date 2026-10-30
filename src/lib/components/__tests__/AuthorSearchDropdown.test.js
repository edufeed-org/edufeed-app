// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import AuthorSearchDropdown from '$lib/components/discover/AuthorSearchDropdown.svelte';
import { directory } from './fixtures/member-directory-mock.svelte.js';

vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: { searchContacts: vi.fn(() => []) }
}));
vi.mock(
  '$lib/stores/member-directory.svelte.js',
  () => import('./fixtures/member-directory-mock.svelte.js')
);
const known = vi.hoisted(() => ({ searchKnownProfiles: vi.fn(() => []) }));
vi.mock('$lib/loaders/profile-search.js', () => ({
  searchKnownProfiles: known.searchKnownProfiles
}));

const profileMap = new Map([
  ['a'.repeat(64), { name: 'alice', display_name: 'Alice' }],
  ['b'.repeat(64), { name: 'alfred', display_name: 'Alfred' }]
]);

/** @param {string} key */
const key = (key) => new KeyboardEvent('keydown', { key, cancelable: true });

function setup() {
  const onselect = vi.fn();
  const { component } = render(AuthorSearchDropdown, {
    props: { searchTerm: 'al', profileMap, onselect, visible: true }
  });
  flushSync();
  return { onselect, component };
}

beforeEach(() => {
  directory.members = new Set();
  known.searchKnownProfiles.mockReset();
  known.searchKnownProfiles.mockReturnValue([]);
});

describe('AuthorSearchDropdown', () => {
  it('shows suggestions without highlighting any of them', () => {
    setup();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    for (const option of options) expect(option.getAttribute('aria-selected')).toBe('false');
  });

  it('leaves Enter to the search field when nothing is highlighted', () => {
    const { onselect, component } = setup();
    const event = key('Enter');
    expect(component.handleKeydown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(onselect).not.toHaveBeenCalled();
  });

  it('selects the suggestion reached with ArrowDown on Enter', () => {
    const { onselect, component } = setup();
    component.handleKeydown(key('ArrowDown'));
    flushSync();
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    expect(component.handleKeydown(key('Enter'))).toBe(true);
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ name: 'alfred' }));
  });

  it('ArrowUp from nothing highlighted wraps to the last suggestion', () => {
    const { onselect, component } = setup();
    component.handleKeydown(key('ArrowUp'));
    component.handleKeydown(key('Enter'));
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ name: 'alice' }));
  });

  it('puts members of the NIP-05 directory first, including ones with nothing on the page', () => {
    const PAULA = 'c'.repeat(64);
    directory.members = new Set([PAULA, 'a'.repeat(64)]);
    known.searchKnownProfiles.mockImplementation((_t, _l, opts = {}) =>
      opts.authors
        ? [{ pubkey: PAULA, name: 'alma', display_name: 'Alma', nip05: 'alma@edufeed.org' }]
        : []
    );
    setup();
    const names = screen
      .getAllByRole('option')
      .map((o) => o.querySelector('.font-medium')?.textContent?.trim());
    expect(names).toEqual(['Alice', 'Alma', 'Alfred']); // members (page order kept), then Alfred
  });
});
