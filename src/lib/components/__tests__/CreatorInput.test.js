// @ts-nocheck
/**
 * CreatorInput edit flow regression test
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// jsdom does not implement matchMedia — stub before any module that touches
// app-settings.svelte.js is imported.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  });
}

const CreatorInput = (await import('../educational/CreatorInput.svelte')).default;

vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: {
    get contacts() {
      return [];
    },
    get isLoading() {
      return false;
    },
    get isLoaded() {
      return true;
    },
    searchContacts: vi.fn(() => [])
  }
}));

vi.mock('$lib/stores/user-profile.svelte', () => ({
  useUserProfile: () => () => undefined
}));

vi.mock('$lib/helpers/profile.js', () => ({
  fetchProfileData: vi.fn(async () => ({}))
}));

vi.mock('$lib/paraglide/messages', () => ({
  amb_creator_type_person: () => 'Person',
  amb_creator_type_organization: () => 'Organization',
  amb_creator_heading_edit: () => 'Edit creator',
  amb_creator_heading_add: () => 'Add creator',
  amb_creator_label_nostr: () => 'Nostr',
  amb_creator_placeholder_search: () => 'Search…',
  amb_creator_label_name: () => 'Name',
  amb_creator_placeholder_name: () => 'Name…',
  amb_creator_label_type: () => 'Type',
  amb_creator_label_title: () => 'Title',
  amb_creator_placeholder_title: () => 'Title…',
  amb_creator_label_affiliation: () => 'Affiliation',
  amb_creator_placeholder_affiliation: () => 'Affiliation…',
  amb_creator_button_add: () => 'Add',
  amb_creator_button_update: () => 'Update',
  amb_creator_edit_aria: () => 'Edit creator',
  amb_creator_remove_aria: () => 'Remove creator',
  common_edit: () => 'Edit',
  common_cancel: () => 'Cancel',
  contact_search_hint: ({ count }) => `Search ${count} follows`,
  contact_search_loading: () => 'Loading…',
  contact_search_enter_npub: () => 'Enter npub'
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreatorInput edit flow', () => {
  it('opens the edit form pre-filled when clicking Edit on an existing creator', async () => {
    const initial = [
      { name: 'Alice', type: 'Person', honorificPrefix: 'Dr.' },
      { name: 'Bob Inc.', type: 'Organization' }
    ];
    const onchange = vi.fn();
    const { getAllByText, getByDisplayValue } = render(CreatorInput, {
      props: { creators: initial, label: 'Creators', onchange }
    });

    const editButtons = getAllByText('Edit');
    expect(editButtons.length).toBe(2);

    // Click first Edit
    await fireEvent.click(editButtons[0]);

    // Form should be pre-filled with Alice's name + title
    expect(getByDisplayValue('Alice')).toBeTruthy();
    expect(getByDisplayValue('Dr.')).toBeTruthy();
  });

  it('updates the existing creator (does not append a new one) when Update is clicked', async () => {
    const initial = [
      { name: 'Alice', type: 'Person' },
      { name: 'Bob', type: 'Person' }
    ];
    const onchange = vi.fn();
    const { getAllByText, getByDisplayValue, getByText } = render(CreatorInput, {
      props: { creators: initial, label: 'Creators', onchange }
    });

    // Open edit form for Alice (index 0)
    await fireEvent.click(getAllByText('Edit')[0]);

    // Change the name
    const nameInput = getByDisplayValue('Alice');
    await fireEvent.input(nameInput, { target: { value: 'Alice Updated' } });

    // Click Update
    await fireEvent.click(getByText('Update'));

    // onchange should fire with updated creators (length still 2, Alice renamed)
    expect(onchange).toHaveBeenCalled();
    const updated = onchange.mock.calls.at(-1)[0];
    expect(updated.length).toBe(2);
    expect(updated[0].name).toBe('Alice Updated');
    expect(updated[1].name).toBe('Bob');
  });
});
