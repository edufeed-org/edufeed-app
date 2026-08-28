// @ts-nocheck
/**
 * ContactSearchInput Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import { contactsStore } from '$lib/stores/contacts.svelte.js';
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
    }),
    // accounts.svelte.js's active$ subscription calls these on login/logout;
    // omitting them turns every emission into an unhandled rejection.
    loadContacts: vi.fn(),
    clear: vi.fn()
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

    // Bob has no picture — ImageWithFallback renders the local avatar placeholder
    const placeholder = container.querySelector(
      '.absolute.z-50 [data-testid="image-fallback-placeholder"]'
    );
    expect(placeholder).toBeTruthy();
  });
});

// ===========================================================================
// New combobox flags: showExcluded + acceptPubkeyInput
// ===========================================================================

const FRESH_HEX = 'f'.repeat(64);
const FRESH_NPUB = nip19.npubEncode(FRESH_HEX);

describe('ContactSearchInput — showExcluded flag', () => {
  it('renders excluded contacts with a badge + aria-disabled instead of hiding them', async () => {
    const onselect = vi.fn();
    const { container, getByText } = render(ContactSearchInput, {
      props: {
        value: '',
        exclude: ['abc123'],
        showExcluded: true,
        excludedLabel: 'Already added',
        onselect
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown).toBeTruthy();
    expect(dropdown.textContent).toContain('Alice Smith');
    expect(getByText('Already added')).toBeTruthy();

    const button = dropdown.querySelector('button');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.disabled).toBe(true);

    await fireEvent.click(button);
    expect(onselect).not.toHaveBeenCalled();
  });

  it('does not render a badge for non-excluded rows', async () => {
    const { container, queryByText } = render(ContactSearchInput, {
      props: {
        value: '',
        exclude: ['def456'],
        showExcluded: true,
        excludedLabel: 'Already added'
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    // Alice is not excluded — no badge text should appear
    expect(queryByText('Already added')).toBeNull();

    const button = container.querySelector('.absolute.z-50 button');
    expect(button?.getAttribute('aria-disabled')).not.toBe('true');
    expect(button?.disabled).toBe(false);
  });
});

describe('ContactSearchInput — acceptPubkeyInput flag', () => {
  it('appends a synthetic "Add profile" row when a valid npub has no name match', async () => {
    const onrawpubkey = vi.fn();
    const { container, getByText } = render(ContactSearchInput, {
      props: {
        value: '',
        acceptPubkeyInput: true,
        addPubkeyLabel: 'Add profile',
        onrawpubkey
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: FRESH_NPUB } });

    expect(getByText('Add profile')).toBeTruthy();

    const button = container.querySelector('.absolute.z-50 button');
    await fireEvent.click(button);
    expect(onrawpubkey).toHaveBeenCalledWith(FRESH_HEX);
  });

  it('accepts a raw 64-char hex pubkey just like an npub', async () => {
    const onrawpubkey = vi.fn();
    const { container } = render(ContactSearchInput, {
      props: {
        value: '',
        acceptPubkeyInput: true,
        addPubkeyLabel: 'Add profile',
        onrawpubkey
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: FRESH_HEX } });

    const button = container.querySelector('.absolute.z-50 button');
    await fireEvent.click(button);
    expect(onrawpubkey).toHaveBeenCalledWith(FRESH_HEX);
  });

  it('omits the synthetic row when the npub decodes to a pubkey already in matches', async () => {
    // Make searchContacts return a contact whose pubkey equals the decoded hex,
    // simulating the edge case where the typed npub belongs to a known contact.
    vi.mocked(contactsStore.searchContacts).mockReturnValueOnce([
      {
        pubkey: FRESH_HEX,
        name: 'fresh',
        display_name: 'Fresh',
        picture: null,
        nip05: null,
        about: null
      }
    ]);

    const onrawpubkey = vi.fn();
    const { container, queryByText } = render(ContactSearchInput, {
      props: {
        value: '',
        acceptPubkeyInput: true,
        addPubkeyLabel: 'Add profile',
        onrawpubkey
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: FRESH_NPUB } });

    // The contact row represents this pubkey — no separate synthetic row
    expect(queryByText('Add profile')).toBeNull();

    const buttons = container.querySelectorAll('.absolute.z-50 button');
    expect(buttons.length).toBe(1);
  });

  it('marks the synthetic row as excluded when showExcluded + exclude contain the pubkey', async () => {
    const onrawpubkey = vi.fn();
    const { container, getByText } = render(ContactSearchInput, {
      props: {
        value: '',
        acceptPubkeyInput: true,
        showExcluded: true,
        addPubkeyLabel: 'Add profile',
        excludedLabel: 'Already added',
        exclude: [FRESH_HEX],
        onrawpubkey
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: FRESH_NPUB } });

    expect(getByText('Add profile')).toBeTruthy();
    expect(getByText('Already added')).toBeTruthy();

    const button = container.querySelector('.absolute.z-50 button');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.disabled).toBe(true);

    await fireEvent.click(button);
    expect(onrawpubkey).not.toHaveBeenCalled();
  });

  it('does not show the synthetic row for gibberish (no dropdown at all)', async () => {
    const { container } = render(ContactSearchInput, {
      props: {
        value: '',
        acceptPubkeyInput: true,
        addPubkeyLabel: 'Add profile'
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'not-a-valid-npub' } });

    expect(container.querySelector('.absolute.z-50')).toBeNull();
  });

  it('fires onrawpubkey when Enter is pressed on the synthetic row', async () => {
    const onrawpubkey = vi.fn();
    const { container } = render(ContactSearchInput, {
      props: {
        value: '',
        acceptPubkeyInput: true,
        addPubkeyLabel: 'Add profile',
        onrawpubkey
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: FRESH_NPUB } });

    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onrawpubkey).toHaveBeenCalledWith(FRESH_HEX);
  });

  it('navigates through contacts and then the synthetic pubkey row with ArrowDown', async () => {
    // Search term 'al' matches Alice; acceptPubkeyInput=false keeps behaviour unchanged,
    // but with acceptPubkeyInput=true + a npub we should have two nav items max when
    // combined. Here we test a term that yields one contact AND is a valid npub via
    // a mock override.
    vi.mocked(contactsStore.searchContacts).mockReturnValueOnce([
      {
        pubkey: 'abc123',
        name: 'alice',
        display_name: 'Alice Smith',
        picture: null,
        nip05: null,
        about: null
      }
    ]);
    const onselect = vi.fn();
    const onrawpubkey = vi.fn();
    const { container } = render(ContactSearchInput, {
      props: {
        value: '',
        acceptPubkeyInput: true,
        addPubkeyLabel: 'Add profile',
        onselect,
        onrawpubkey
      }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: FRESH_NPUB } });

    // ArrowDown should land on the contact first
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    // ArrowDown again should land on the pubkey row
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onselect).not.toHaveBeenCalled();
    expect(onrawpubkey).toHaveBeenCalledWith(FRESH_HEX);
  });
});

describe('ContactSearchInput — regression: default flags preserve existing behaviour', () => {
  it('hides excluded contacts from the dropdown (showExcluded=false)', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '', exclude: ['abc123'] }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown).toBeNull();
  });

  it('does not add a synthetic row for a valid npub (acceptPubkeyInput=false)', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '' }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: FRESH_NPUB } });

    expect(container.querySelector('.absolute.z-50')).toBeNull();
  });
});

describe('ContactSearchInput — inlineList flag', () => {
  it('renders the suggestion list in normal flow (no absolute positioning)', async () => {
    const { container } = render(ContactSearchInput, {
      props: { value: '', inlineList: true }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    expect(container.querySelector('.absolute.z-50')).toBeNull();
    const list = container.querySelector('[data-testid="contact-search-list"]');
    expect(list).toBeTruthy();
    expect(list?.classList.contains('absolute')).toBe(false);
    expect(list?.textContent).toContain('Alice Smith');
  });

  it('still selects a contact from the inline list', async () => {
    const onselect = vi.fn();
    const { container } = render(ContactSearchInput, {
      props: { value: '', inlineList: true, onselect }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    const button = container.querySelector('[data-testid="contact-search-list"] button');
    await fireEvent.click(button);
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ pubkey: 'abc123' }));
  });
});
