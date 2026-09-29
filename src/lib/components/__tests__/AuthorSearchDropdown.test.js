/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import AuthorSearchDropdown from '$lib/components/discover/AuthorSearchDropdown.svelte';

vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: { searchContacts: vi.fn(() => []) }
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
});
