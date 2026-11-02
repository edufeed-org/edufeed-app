// @ts-nocheck
/**
 * FollowListModal — the people behind "N Follower" / "M Gefolgt" on a
 * profile: alphabetical by name, searchable, an A-Z index rail, a
 * "only people I follow" filter and per-row follow buttons.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import FollowListModal from '../profile/FollowListModal.svelte';

const { profilesRef, activeUserRef, contactsRef, contactListRef, toggleFollow } = vi.hoisted(
  () => ({
    profilesRef: { value: new Map() },
    activeUserRef: { value: null },
    contactsRef: { isLoaded: false },
    contactListRef: { value: undefined },
    toggleFollow: vi.fn(async () => true)
  })
);

vi.mock(
  '$lib/components/shared/ProfileCard.svelte',
  () => import('./fixtures/ProfileCardStub.svelte')
);
vi.mock('$lib/paraglide/messages', () => ({
  common_close: () => 'Close',
  common_show_more: () => 'Show more',
  profile_follow_button: () => 'Follow',
  profile_unfollow_button: () => 'Unfollow',
  profile_follow_list_search_label: () => 'Search this list',
  profile_follow_list_search_placeholder: () => 'Name, NIP-05 or npub',
  profile_follow_list_no_match: () => 'No one matches',
  profile_follow_list_only_followed: () => 'Only people I follow',
  profile_follow_list_index_label: () => 'Alphabetical index',
  profile_follow_list_jump_to: ({ letter }) => `Jump to ${letter}`,
  profile_follow_list_jump_to_other: () => 'Jump to other names'
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => profilesRef.value
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => activeUserRef.value
}));
vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: {
    get isLoaded() {
      return contactsRef.isLoaded;
    }
  }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: () => ({
      subscribe: (next) => {
        next(contactListRef.value);
        return { unsubscribe: vi.fn() };
      }
    })
  }
}));
vi.mock('$lib/helpers/follow.js', () => ({ toggleFollow }));

const pk = (i) => i.toString(16).padStart(64, '0');
const rows = (container) =>
  [...container.querySelectorAll('[data-testid="follow-list-row"]')].map((el) => el.dataset.pubkey);
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** n people, person i named `${letter}${i}` with letters cycling through `letters`. */
function people(n, letters = LETTERS) {
  const pubkeys = Array.from({ length: n }, (_, i) => pk(i + 1));
  profilesRef.value = new Map(
    pubkeys.map((p, i) => [
      p,
      { name: `${letters[i % letters.length]}person${String(i).padStart(3, '0')}` }
    ])
  );
  return pubkeys;
}

function renderModal(props) {
  return render(FollowListModal, {
    props: { title: 'Followers', viewerFollows: [], onclose: vi.fn(), ...props }
  });
}

/** Log in as `me` with a loaded contact list. */
function login(me = pk(999)) {
  activeUserRef.value = { pubkey: me };
  contactsRef.isLoaded = true;
  contactListRef.value = { kind: 3, pubkey: me, tags: [] };
}

beforeEach(() => {
  profilesRef.value = new Map();
  activeUserRef.value = null;
  contactsRef.isLoaded = false;
  contactListRef.value = undefined;
  toggleFollow.mockClear();
});

describe('FollowListModal', () => {
  it('sorts alphabetically by name, nameless people last', () => {
    profilesRef.value = new Map([
      [pk(1), { name: 'zoe' }],
      [pk(2), { display_name: 'Ärger' }],
      [pk(3), { name: 'Bernd' }]
    ]);
    const { container } = renderModal({ pubkeys: [pk(4), pk(1), pk(2), pk(3)] });
    expect(container.textContent).toContain('Followers');
    expect(rows(container)).toEqual([pk(2), pk(3), pk(1), pk(4)]);
  });

  it('no longer marks the viewer’s follows with a badge', () => {
    const { container } = renderModal({ pubkeys: [pk(1), pk(2)], viewerFollows: [pk(2)] });
    expect(container.querySelector('[data-testid="follow-list-known"]')).toBeNull();
  });

  it('shows a page of 50 and more on request', async () => {
    const pubkeys = people(60);
    const { container, getByRole } = renderModal({ pubkeys });
    expect(rows(container)).toHaveLength(50);
    await fireEvent.click(getByRole('button', { name: 'Show more' }));
    expect(rows(container)).toHaveLength(60);
  });

  it('closes', async () => {
    const onclose = vi.fn();
    const { getAllByRole } = renderModal({ pubkeys: [pk(1)], onclose });
    // The action button and the backdrop both close.
    const [button, backdrop] = getAllByRole('button', { name: 'Close' });
    await fireEvent.click(button);
    await fireEvent.click(backdrop);
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  describe('search', () => {
    it('filters by name, NIP-05 and npub; every word, case- and diacritics-insensitive', async () => {
      profilesRef.value = new Map([
        [pk(1), { display_name: 'Jörg Müller', nip05: 'jm@edufeed.org' }],
        [pk(2), { name: 'Anna Schmidt', nip05: 'anna@example.com' }],
        [pk(3), { name: 'Bernd' }]
      ]);
      const { container, getByRole } = renderModal({ pubkeys: [pk(1), pk(2), pk(3)] });
      const input = getByRole('searchbox', { name: 'Search this list' });

      await fireEvent.input(input, { target: { value: 'MULLER jorg' } });
      expect(rows(container)).toEqual([pk(1)]);

      await fireEvent.input(input, { target: { value: 'example.com' } });
      expect(rows(container)).toEqual([pk(2)]);

      const { hexToNpub } = await import('$lib/helpers/pubkey.js');
      await fireEvent.input(input, { target: { value: hexToNpub(pk(3)) } });
      expect(rows(container)).toEqual([pk(3)]);

      await fireEvent.input(input, { target: { value: '' } });
      expect(rows(container)).toHaveLength(3);
    });

    it('shows a message when nobody matches', async () => {
      profilesRef.value = new Map([[pk(1), { name: 'Anna' }]]);
      const { container, getByRole } = renderModal({ pubkeys: [pk(1)] });
      expect(container.textContent).not.toContain('No one matches');
      await fireEvent.input(getByRole('searchbox'), { target: { value: 'xyz' } });
      expect(rows(container)).toHaveLength(0);
      expect(container.textContent).toContain('No one matches');
    });

    it('pages the filtered list and resets paging when the query changes', async () => {
      const pubkeys = people(120, 'AB');
      const { container, getByRole, queryByRole } = renderModal({ pubkeys });
      await fireEvent.click(getByRole('button', { name: 'Show more' }));
      await fireEvent.click(getByRole('button', { name: 'Show more' }));
      expect(rows(container)).toHaveLength(120);

      // 60 people start with A: one page, then "show more" for the rest.
      await fireEvent.input(getByRole('searchbox'), { target: { value: 'aperson' } });
      expect(rows(container)).toHaveLength(50);
      await fireEvent.click(getByRole('button', { name: 'Show more' }));
      expect(rows(container)).toHaveLength(60);
      expect(queryByRole('button', { name: 'Show more' })).toBeNull();
    });
  });

  describe('A-Z index rail', () => {
    /** @type {any[]} */
    let scrolls;
    beforeEach(() => {
      scrolls = [];
      // Layout stand-in: each row sits 10px below the previous one.
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
        configurable: true,
        get() {
          const row = this.closest?.('[data-testid="follow-list-row"]');
          if (!row) return 0;
          return [...row.parentElement.children].indexOf(row) * 10;
        }
      });
      HTMLElement.prototype.scrollTo = function (opts) {
        scrolls.push({ el: this, top: opts.top });
      };
    });
    afterEach(() => {
      delete HTMLElement.prototype.offsetTop;
      delete HTMLElement.prototype.scrollTo;
    });

    it('is absent below 20 people and present from 20 on', async () => {
      let pubkeys = people(19);
      const first = renderModal({ pubkeys });
      expect(first.queryByTestId('follow-list-rail')).toBeNull();
      first.unmount();

      pubkeys = people(20);
      const { getByTestId, getByRole } = renderModal({ pubkeys });
      expect(getByTestId('follow-list-rail')).toBeTruthy();
      expect(getByRole('navigation', { name: 'Alphabetical index' })).toBeTruthy();
    });

    it('follows the filtered list: hidden when a search leaves fewer than 20', async () => {
      const pubkeys = people(40, 'AB');
      const { getByRole, queryByTestId } = renderModal({ pubkeys });
      expect(queryByTestId('follow-list-rail')).toBeTruthy();
      await fireEvent.input(getByRole('searchbox'), { target: { value: 'person001' } });
      expect(queryByTestId('follow-list-rail')).toBeNull();
    });

    it('dims and disables letters without entries; the others are focusable buttons', () => {
      const pubkeys = people(30, 'AMZ');
      const { getByRole } = renderModal({ pubkeys });
      expect(getByRole('button', { name: 'Jump to A' }).disabled).toBe(false);
      expect(getByRole('button', { name: 'Jump to M' }).disabled).toBe(false);
      expect(getByRole('button', { name: 'Jump to B' }).disabled).toBe(true);
      expect(getByRole('button', { name: 'Jump to other names' }).disabled).toBe(true);
    });

    it('scrolls the list so the first person with the letter is at the top', async () => {
      const pubkeys = people(30, 'AMZ');
      const { container, getByRole } = renderModal({ pubkeys });
      await fireEvent.click(getByRole('button', { name: 'Jump to M' }));
      await tick();
      const list = container.querySelector('[data-testid="follow-list"]');
      // 10 A people come first, so the first M is row 10.
      expect(scrolls).toEqual([{ el: list, top: 100 }]);
      expect(rows(container)[10]).toBe(pubkeys[1]);
    });

    it('renders further pages when the letter lies beyond the shown page', async () => {
      // 70 A people, then 10 Z people: Z starts at row 70.
      const pubkeys = people(80, 'A');
      for (let i = 70; i < 80; i++) profilesRef.value.set(pubkeys[i], { name: `Zed${i}` });
      profilesRef.value = new Map(profilesRef.value);
      const { container, getByRole } = renderModal({ pubkeys });
      expect(rows(container)).toHaveLength(50);
      await fireEvent.click(getByRole('button', { name: 'Jump to Z' }));
      await waitFor(() => expect(scrolls).toHaveLength(1));
      expect(rows(container).length).toBeGreaterThanOrEqual(71);
      expect(rows(container)[70]).toBe(pubkeys[70]);
      expect(scrolls[0].top).toBe(700);
    });

    it('jumps while pressing and dragging along the rail', async () => {
      const pubkeys = people(30, 'AMZ');
      const { getByTestId } = renderModal({ pubkeys });
      const rail = getByTestId('follow-list-rail');
      // 27 slots of 10px each: A at 0-10, M at 120-130, Z at 250-260.
      rail.getBoundingClientRect = () => ({ top: 0, height: 270, bottom: 270, left: 0, right: 20 });
      rail.setPointerCapture = vi.fn();
      await fireEvent.pointerDown(rail, { pointerId: 1, clientY: 5 });
      await fireEvent.pointerMove(rail, { pointerId: 1, clientY: 125 });
      await fireEvent.pointerMove(rail, { pointerId: 1, clientY: 255 });
      await fireEvent.pointerUp(rail, { pointerId: 1, clientY: 255 });
      await fireEvent.pointerMove(rail, { pointerId: 1, clientY: 5 });
      await waitFor(() => expect(scrolls).toHaveLength(3));
      expect(scrolls.map((s) => s.top)).toEqual([0, 100, 200]);
    });
  });

  describe('logged-in viewer', () => {
    it('offers no filter or follow buttons when logged out', () => {
      const { queryByRole, queryAllByRole } = renderModal({ pubkeys: [pk(1), pk(2)] });
      expect(queryByRole('checkbox', { name: /Only people I follow/ })).toBeNull();
      expect(queryAllByRole('button', { name: /^(Follow|Unfollow)$/ })).toHaveLength(0);
    });

    it('offers the follow filter only when the viewer follows someone listed', () => {
      login();
      const { queryByRole } = renderModal({ pubkeys: [pk(1), pk(2)], viewerFollows: [pk(7)] });
      expect(queryByRole('checkbox', { name: /Only people I follow/ })).toBeNull();
    });

    it('filters to the people the viewer follows', async () => {
      login();
      profilesRef.value = new Map([
        [pk(1), { name: 'Anna' }],
        [pk(2), { name: 'Bernd' }],
        [pk(3), { name: 'Carla' }]
      ]);
      const { container, getByRole } = renderModal({
        pubkeys: [pk(1), pk(2), pk(3)],
        viewerFollows: [pk(3), pk(1)]
      });
      const toggle = getByRole('checkbox', { name: /Only people I follow/ });
      await fireEvent.click(toggle);
      expect(rows(container)).toEqual([pk(1), pk(3)]);
      await fireEvent.click(toggle);
      expect(rows(container)).toEqual([pk(1), pk(2), pk(3)]);
    });

    it('shows follow / unfollow per row, never on the viewer’s own row', async () => {
      const me = pk(9);
      login(me);
      profilesRef.value = new Map([
        [pk(1), { name: 'Anna' }],
        [pk(2), { name: 'Bernd' }],
        [me, { name: 'Ich' }]
      ]);
      const { container } = renderModal({ pubkeys: [pk(1), pk(2), me], viewerFollows: [pk(2)] });
      const button = (p) =>
        container.querySelector(`[data-pubkey="${p}"] [data-testid="follow-list-follow"]`);
      expect(button(pk(1)).textContent.trim()).toBe('Follow');
      expect(button(pk(2)).textContent.trim()).toBe('Unfollow');
      expect(button(me)).toBeNull();

      await fireEvent.click(button(pk(1)));
      expect(toggleFollow).toHaveBeenCalledWith(pk(1), false);
      await fireEvent.click(button(pk(2)));
      expect(toggleFollow).toHaveBeenCalledWith(pk(2), true);
    });

    it('waits for the viewer’s own contact list before offering follow buttons', () => {
      login();
      contactListRef.value = undefined;
      const { container } = renderModal({ pubkeys: [pk(1)] });
      expect(container.querySelector('[data-testid="follow-list-follow"]')).toBeNull();
    });
  });
});
