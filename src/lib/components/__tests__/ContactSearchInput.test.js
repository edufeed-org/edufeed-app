// @ts-nocheck
/**
 * ContactSearchInput Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ContactSearchInput from '../shared/ContactSearchInput.svelte';

// Mock contacts data
const mockContacts = [
  {
    pubkey: 'abc123',
    name: 'alice',
    display_name: 'Alice Smith',
    picture: 'https://example.com/alice.jpg',
    nip05: 'alice@example.com',
    about: null
  },
  {
    pubkey: 'def456',
    name: 'bob',
    display_name: 'Bob Jones',
    picture: null,
    nip05: null,
    about: null
  },
  {
    pubkey: 'ghi789',
    name: 'charlie',
    display_name: 'Charlie Brown',
    picture: null,
    nip05: 'charlie@test.com',
    about: null
  }
];

vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: {
    get contacts() {
      return ['abc123', 'def456', 'ghi789'];
    },
    get isLoading() {
      return false;
    },
    get isLoaded() {
      return true;
    },
    searchContacts: vi.fn((term, limit) => {
      const t = term.toLowerCase();
      return mockContacts
        .filter(
          (c) =>
            (c.name || '').toLowerCase().includes(t) ||
            (c.display_name || '').toLowerCase().includes(t)
        )
        .slice(0, limit);
    })
  }
}));

vi.mock('$lib/paraglide/messages', () => ({
  contact_search_hint: ({ count }) => `Search ${count} follows or enter npub`,
  contact_search_loading: () => 'Loading contacts...',
  contact_search_enter_npub: () => 'Enter npub to search'
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContactSearchInput', () => {
  it('renders an input element', () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '' }
    });
    const input = container.querySelector('input');
    expect(input).toBeTruthy();
  });

  it('passes id and placeholder to the input', () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '', id: 'test-input', placeholder: 'Search...' }
    });
    const input = container.querySelector('input');
    expect(input?.id).toBe('test-input');
    expect(input?.placeholder).toBe('Search...');
  });

  it('shows status hint with contact count when loaded', () => {
    const { getByText } = render(ContactSearchInput, {
      props: { value: '' }
    });
    expect(getByText('Search 3 follows or enter npub')).toBeTruthy();
  });

  it('does not show dropdown when typing less than 2 characters', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '' }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'a' } });

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown).toBeNull();
  });

  it('shows dropdown when typing 2+ characters that match contacts', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '' }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown).toBeTruthy();
    expect(dropdown?.textContent).toContain('Alice Smith');
  });

  it('calls onselect with correct contact when clicking a dropdown item', async () => {
    const onselect = vi.fn();
    const { container } = render(ContactSearchInput, {
      props: { value: '', onselect }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    const button = container.querySelector('.absolute.z-50 button');
    expect(button).toBeTruthy();
    await fireEvent.click(button);

    expect(onselect).toHaveBeenCalledWith(mockContacts[0]);
  });

  it('filters out excluded pubkeys from results', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '', exclude: ['abc123'] }
    });
    const input = container.querySelector('input');
    // Search for something that would match Alice
    await fireEvent.input(input, { target: { value: 'al' } });

    const dropdown = container.querySelector('.absolute.z-50');
    // Alice should be filtered out, no other matches for "al"
    expect(dropdown).toBeNull();
  });

  it('navigates dropdown with ArrowDown and selects with Enter', async () => {
    const onselect = vi.fn();
    const { container } = render(ContactSearchInput, {
      props: { value: '', onselect }
    });
    const input = container.querySelector('input');

    // Type to show dropdown with multiple results
    await fireEvent.input(input, { target: { value: 'bo' } });

    // Navigate down and select
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onselect).toHaveBeenCalledWith(mockContacts[1]);
  });

  it('closes dropdown on Escape', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '' }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    // Verify dropdown is open
    expect(container.querySelector('.absolute.z-50')).toBeTruthy();

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('.absolute.z-50')).toBeNull();
  });

  it('applies inputClass to the input element', () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '', inputClass: 'font-mono text-sm' }
    });
    const input = container.querySelector('input');
    expect(input?.classList.contains('font-mono')).toBe(true);
    expect(input?.classList.contains('text-sm')).toBe(true);
  });

  it('disables input when disabled prop is true', () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '', disabled: true }
    });
    const input = container.querySelector('input');
    expect(input?.disabled).toBe(true);
  });

  it('shows nip05 in dropdown when available', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '' }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown?.textContent).toContain('alice@example.com');
  });

  it('shows profile picture in dropdown when available', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '' }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    const img = container.querySelector('.absolute.z-50 img');
    expect(img).toBeTruthy();
    // Image goes through proxy, so src contains the original URL as a query param
    expect(img?.getAttribute('src')).toContain('alice.jpg');
  });

  it('shows fallback avatar when no picture', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '' }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'bo' } });

    // Bob has no picture — ImageWithFallback renders a robohash fallback img
    const img = container.querySelector('.absolute.z-50 img');
    expect(img).toBeTruthy();
  });
});
