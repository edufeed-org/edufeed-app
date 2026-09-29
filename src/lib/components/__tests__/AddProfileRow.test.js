// @ts-nocheck
/**
 * AddProfileRow Component Tests
 *
 * AddProfileRow is a thin wrapper around ContactSearchInput with the
 * showExcluded + acceptPubkeyInput + searchProfiles flags enabled. These
 * tests exercise the prop forwarding and the fan-in from
 * onselect/onrawpubkey → onadd — including people OUTSIDE the follow list
 * found by the NIP-50 profile search ("Gendering MINT digital" was not in
 * the list owner's follows and could not be added by name).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import { Subject } from 'rxjs';
import { tick } from 'svelte';
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
    searchContacts: vi.fn(() => []),
    // accounts.svelte.js's active$ subscription calls these on login/logout;
    // omitting them turns every emission into an unhandled rejection.
    loadContacts: vi.fn(),
    clear: vi.fn()
  }
}));

vi.mock('$lib/paraglide/messages', () => ({
  contact_search_hint: ({ count }) => `Search ${count} follows`,
  contact_search_loading: () => 'Loading...',
  contact_search_enter_npub: () => 'Enter npub',
  list_detail_add_profile_search_placeholder: () => 'Search by name or paste an npub',
  list_detail_add_profile_already_added: () => 'Already added',
  list_detail_add_profile_add_pubkey: () => 'Add profile',
  contact_search_profiles_hint: () => 'Search by name or enter npub',
  contact_search_profiles_searching: () => 'Searching relays…',
  contact_search_wot_known: () => 'in web of trust',
  contact_search_wot_title: ({ hops, followers }) => `${hops} hops · ${followers} followers`
}));

// searchProfiles mode: known profiles (EventStore) + NIP-50 relay search,
// mocked the same way ContactSearchInput.test.js does.
const profileSearch = vi.hoisted(() => ({
  searchKnownProfiles: vi.fn(() => []),
  profileNameSearchLoader: vi.fn(),
  /** @type {import('rxjs').Subject<any> | null} */
  remote: null
}));

vi.mock('$lib/loaders/profile-search.js', () => ({
  searchKnownProfiles: profileSearch.searchKnownProfiles,
  profileNameSearchLoader: profileSearch.profileNameSearchLoader,
  profileToContact: (event) => {
    const c = JSON.parse(event.content);
    return {
      pubkey: event.pubkey,
      name: c.name ?? null,
      display_name: c.display_name ?? null,
      picture: c.picture ?? null,
      nip05: c.nip05 ?? null,
      about: null
    };
  },
  profileMatches: (contact, term) => {
    const t = term.toLowerCase();
    return [contact.name, contact.display_name, contact.nip05].some((v) =>
      (v || '').toLowerCase().includes(t)
    );
  }
}));

vi.mock(
  '$lib/stores/trust-scores.svelte.js',
  () => import('./fixtures/trust-scores-mock.svelte.js')
);

beforeEach(() => {
  vi.clearAllMocks();
  profileSearch.remote = new Subject();
  profileSearch.searchKnownProfiles.mockReset();
  profileSearch.searchKnownProfiles.mockReturnValue([]);
  profileSearch.profileNameSearchLoader.mockReset();
  profileSearch.profileNameSearchLoader.mockImplementation(() => profileSearch.remote);
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

  describe('people outside the follow list', () => {
    const GENDERING = 'f9358a4cb9e537a4b4ceb7c67017a080eb555aa79e21a5acc9024f3edba26c67';
    const genderingEvent = {
      kind: 0,
      pubkey: GENDERING,
      tags: [],
      content: JSON.stringify({
        name: 'Gendering MINT digital',
        nip05: 'gendering-mint@edufeed.org'
      })
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('offers a non-follow profile from the NIP-50 search and adds its hex pubkey', async () => {
      const onadd = vi.fn();
      const { container } = render(AddProfileRow, { props: { onadd } });
      const input = container.querySelector('input');
      await fireEvent.input(input, { target: { value: 'Gendering' } });

      vi.advanceTimersByTime(400);
      await tick();
      expect(profileSearch.profileNameSearchLoader).toHaveBeenCalledWith(
        'Gendering',
        expect.any(Number)
      );

      profileSearch.remote.next(genderingEvent);
      await tick();

      const list = container.querySelector('[data-testid="contact-search-list"]');
      expect(list?.textContent).toContain('Gendering MINT digital');

      const button = list.querySelector('button');
      expect(button?.disabled).toBe(false);
      await fireEvent.click(button);

      expect(onadd).toHaveBeenCalledWith(GENDERING);
      expect(input.value).toBe('');
    });

    it('shows a remote hit that is already on the list as disabled "Already added"', async () => {
      const onadd = vi.fn();
      const { container, getByText } = render(AddProfileRow, {
        props: { onadd, excludePubkeys: [GENDERING] }
      });
      const input = container.querySelector('input');
      await fireEvent.input(input, { target: { value: 'Gendering' } });
      vi.advanceTimersByTime(400);
      await tick();
      profileSearch.remote.next(genderingEvent);
      await tick();

      expect(getByText('Already added')).toBeTruthy();
      const button = container.querySelector('[data-testid="contact-search-list"] button');
      expect(button?.disabled).toBe(true);
      await fireEvent.click(button);
      expect(onadd).not.toHaveBeenCalled();
    });
  });
});
