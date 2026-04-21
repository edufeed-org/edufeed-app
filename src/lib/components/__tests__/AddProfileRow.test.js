// @ts-nocheck
/**
 * AddProfileRow Component Tests
 *
 * AddProfileRow is now a thin wrapper around ContactSearchInput with the
 * showExcluded + acceptPubkeyInput flags enabled. These tests exercise the
 * prop forwarding and the fan-in from onselect/onrawpubkey → onadd.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import { contactsStore } from '$lib/stores/contacts.svelte.js';
import AddProfileRow from '../lists/AddProfileRow.svelte';

const TEST_HEX_1 = 'a'.repeat(64);
const TEST_HEX_2 = 'b'.repeat(64);
const TEST_NPUB_1 = nip19.npubEncode(TEST_HEX_1);
const TEST_NPUB_2 = nip19.npubEncode(TEST_HEX_2);

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

vi.mock('$lib/paraglide/messages', () => ({
  contact_search_hint: ({ count }) => `Search ${count} follows`,
  contact_search_loading: () => 'Loading...',
  contact_search_enter_npub: () => 'Enter npub',
  list_detail_add_profile_search_placeholder: () => 'Search by name or paste an npub',
  list_detail_add_profile_already_added: () => 'Already added',
  list_detail_add_profile_add_pubkey: () => 'Add profile'
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AddProfileRow', () => {
  it('renders a single combobox input (no Search/Paste tabs)', () => {
    const { container, queryByText } = render(AddProfileRow, { props: { onadd: vi.fn() } });
    const input = container.querySelector('input');
    expect(input).toBeTruthy();
    expect(input?.placeholder).toBe('Search by name or paste an npub');
    expect(queryByText('Search')).toBeNull();
    expect(queryByText('Paste')).toBeNull();
  });

  it('calls onadd(hex) when the synthetic pubkey row is clicked for a valid npub', async () => {
    const onadd = vi.fn();
    const { container } = render(AddProfileRow, { props: { onadd } });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: TEST_NPUB_2 } });

    const button = container.querySelector('.absolute.z-50 button');
    expect(button).toBeTruthy();
    await fireEvent.click(button);

    expect(onadd).toHaveBeenCalledWith(TEST_HEX_2);
    expect(input.value).toBe('');
  });

  it('accepts a raw 64-char hex pubkey', async () => {
    const onadd = vi.fn();
    const { container } = render(AddProfileRow, { props: { onadd } });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: TEST_HEX_2 } });

    const button = container.querySelector('.absolute.z-50 button');
    await fireEvent.click(button);

    expect(onadd).toHaveBeenCalledWith(TEST_HEX_2);
  });

  it('calls onadd(pubkey) when a contact row is clicked', async () => {
    vi.mocked(contactsStore.searchContacts).mockReturnValueOnce([
      {
        pubkey: 'contactpubkey',
        name: 'alice',
        display_name: 'Alice',
        picture: null,
        nip05: null,
        about: null
      }
    ]);

    const onadd = vi.fn();
    const { container } = render(AddProfileRow, { props: { onadd } });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    const button = container.querySelector('.absolute.z-50 button');
    await fireEvent.click(button);

    expect(onadd).toHaveBeenCalledWith('contactpubkey');
  });

  it('does not call onadd when the excluded pubkey row is clicked', async () => {
    const onadd = vi.fn();
    const { container, getByText } = render(AddProfileRow, {
      props: { onadd, excludePubkeys: [TEST_HEX_1] }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: TEST_NPUB_1 } });

    // The synthetic row should be marked as already added + disabled
    expect(getByText('Already added')).toBeTruthy();

    const button = container.querySelector('.absolute.z-50 button');
    expect(button?.disabled).toBe(true);

    await fireEvent.click(button);
    expect(onadd).not.toHaveBeenCalled();
  });

  it('does not call onadd when an excluded contact row is clicked', async () => {
    vi.mocked(contactsStore.searchContacts).mockReturnValueOnce([
      {
        pubkey: 'contactpubkey',
        name: 'alice',
        display_name: 'Alice',
        picture: null,
        nip05: null,
        about: null
      }
    ]);

    const onadd = vi.fn();
    const { container, getByText } = render(AddProfileRow, {
      props: { onadd, excludePubkeys: ['contactpubkey'] }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'al' } });

    expect(getByText('Already added')).toBeTruthy();

    const button = container.querySelector('.absolute.z-50 button');
    expect(button?.disabled).toBe(true);

    await fireEvent.click(button);
    expect(onadd).not.toHaveBeenCalled();
  });

  it('disables the input when disabled prop is true', () => {
    const { container } = render(AddProfileRow, {
      props: { onadd: vi.fn(), disabled: true }
    });
    const input = container.querySelector('input');
    expect(input?.disabled).toBe(true);
  });
});
