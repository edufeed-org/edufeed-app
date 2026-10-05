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
    searchContacts: vi.fn(() => []),
    // accounts.svelte.js's active$ subscription calls these on login/logout;
    // omitting them turns every emission into an unhandled rejection.
    loadContacts: vi.fn(),
    clear: vi.fn()
  }
}));

// kind:0 content per pubkey, read through the mocked useUserProfile hook
const profiles = /** @type {Record<string, any>} */ ({});
vi.mock('$lib/stores/user-profile.svelte', () => ({
  useUserProfile: (pubkeyOrGetter) => () => {
    const pk = typeof pubkeyOrGetter === 'function' ? pubkeyOrGetter() : pubkeyOrGetter;
    return pk ? profiles[pk] : undefined;
  }
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
  amb_creator_label_orcid: () => 'ORCID',
  amb_creator_placeholder_orcid: () => 'ORCID…',
  amb_creator_error_orcid_invalid: () => 'Invalid ORCID',
  amb_creator_button_add: () => 'Add',
  amb_creator_button_update: () => 'Update',
  amb_creator_edit_aria: () => 'Edit creator',
  amb_creator_remove_aria: () => 'Remove creator',
  amb_creator_name_from_profile_hint: () => 'Name comes from the Nostr profile',
  amb_creator_button_unlink: () => 'Name only, no profile link',
  common_edit: () => 'Edit',
  common_cancel: () => 'Cancel',
  contact_search_hint: ({ count }) => `Search ${count} follows`,
  contact_search_loading: () => 'Loading…',
  contact_search_enter_npub: () => 'Enter npub'
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(profiles)) delete profiles[k];
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

// NIP-AMB (AMB.md l.26/82/95): a creator with a pubkey is ONLY a p-tag; the
// name comes from kind:0 and a typed name is never published. The form must
// not pretend otherwise — and must offer the name-only (creator:*) form.
describe('CreatorInput linked profile vs. name only (GitHub #20)', () => {
  const PK = 'a'.repeat(64);

  it('shows the kind:0 display name read-only for a creator with a pubkey', async () => {
    profiles[PK] = { name: 'handle', display_name: 'Profile Name' };
    const { getAllByText, getByLabelText, getByText } = render(CreatorInput, {
      props: { creators: [{ name: 'Typed Name', type: 'Person', pubkey: PK }] }
    });
    await fireEvent.click(getAllByText('Edit')[0]);

    const nameInput = getByLabelText(/^Name/);
    expect(nameInput.readOnly).toBe(true);
    expect(nameInput.value).toBe('Profile Name');
    expect(getByText('Name comes from the Nostr profile')).toBeTruthy();
  });

  it('keeps the name editable without a pubkey (no hint, no unlink action)', async () => {
    const { getAllByText, getByLabelText, queryByText } = render(CreatorInput, {
      props: { creators: [{ name: 'Alice', type: 'Person' }] }
    });
    await fireEvent.click(getAllByText('Edit')[0]);

    expect(getByLabelText(/^Name/).readOnly).toBe(false);
    expect(queryByText('Name comes from the Nostr profile')).toBeNull();
    expect(queryByText('Name only, no profile link')).toBeNull();
  });

  it('unlinking clears the pubkey, unlocks the name and saves a name-only creator', async () => {
    profiles[PK] = { name: 'Profile Name' };
    const onchange = vi.fn();
    const { getAllByText, getByLabelText, getByText } = render(CreatorInput, {
      props: { creators: [{ name: 'Profile Name', type: 'Person', pubkey: PK }], onchange }
    });
    await fireEvent.click(getAllByText('Edit')[0]);
    await fireEvent.click(getByText('Name only, no profile link'));

    const nameInput = getByLabelText(/^Name/);
    expect(nameInput.readOnly).toBe(false);
    // current name is kept as the starting value
    expect(nameInput.value).toBe('Profile Name');

    await fireEvent.input(nameInput, { target: { value: 'Erika Mustermann' } });
    await fireEvent.click(getByText('Update'));

    const saved = onchange.mock.calls.at(-1)[0];
    expect(saved).toEqual([{ name: 'Erika Mustermann', type: 'Person' }]);
  });

  it('saves a linked creator with the profile name, not a stale typed one', async () => {
    profiles[PK] = { name: 'Profile Name' };
    const onchange = vi.fn();
    const { getAllByText, getByText } = render(CreatorInput, {
      props: { creators: [{ name: 'Old Typed', type: 'Person', pubkey: PK }], onchange }
    });
    await fireEvent.click(getAllByText('Edit')[0]);
    await fireEvent.click(getByText('Update'));

    const saved = onchange.mock.calls.at(-1)[0];
    expect(saved).toEqual([{ name: 'Profile Name', type: 'Person', pubkey: PK }]);
  });
});
