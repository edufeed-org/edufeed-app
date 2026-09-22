// @ts-nocheck
/**
 * PeopleResults — the discover "Personen" tab body. Renders the
 * usePeopleSearch() state for the active query: the user's follows while
 * the query is empty, a hint when there are none, ranked profile cards
 * with the web-of-trust badge, spinner while relays answer, and an empty
 * state once they are done.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import PeopleResults from '../discover/PeopleResults.svelte';

const REAL = 'd'.repeat(64);
const NOBODY = '9'.repeat(64);
const FOLLOW_A = 'a'.repeat(64);
const FOLLOW_B = 'b'.repeat(64);

const search = vi.hoisted(() => ({
  state: {
    term: '',
    tooShort: true,
    busy: false,
    results: [],
    scores: new Map()
  }
}));
const contacts = vi.hoisted(() => ({ pubkeys: [], isLoaded: true }));

vi.mock('$lib/stores/people-search.svelte.js', () => ({
  usePeopleSearch: () => () => search.state
}));
vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: {
    get contacts() {
      return contacts.pubkeys;
    },
    get isLoaded() {
      return contacts.isLoaded;
    }
  }
}));
vi.mock(
  '$lib/components/shared/ProfileCard.svelte',
  () => import('./fixtures/ProfileCardStub.svelte')
);
vi.mock('$lib/paraglide/messages', () => ({
  people_search_hint: () => 'Type a name to find people',
  people_search_follows_title: () => 'People you follow',
  people_search_searching: () => 'Searching relays…',
  people_search_no_results: ({ term }) => `Nobody named “${term}” found`,
  discover_results_count: ({ count }) => `${count} results found`,
  contact_search_wot_known: () => 'in web of trust',
  contact_search_wot_title: ({ hops, followers }) => `${hops} hops · ${followers} followers`
}));

const contact = (pubkey, name) => ({
  pubkey,
  name,
  display_name: name,
  picture: null,
  nip05: null,
  about: null
});
const cards = (container) =>
  [...container.querySelectorAll('[data-testid="people-result"]')].map((el) => el.dataset.pubkey);

beforeEach(() => {
  search.state = { term: '', tooShort: true, busy: false, results: [], scores: new Map() };
  contacts.pubkeys = [];
  contacts.isLoaded = true;
});

describe('PeopleResults', () => {
  it('shows the follows with a title while the query is empty', () => {
    contacts.pubkeys = [FOLLOW_A, FOLLOW_B];
    const { container } = render(PeopleResults, { props: { query: '' } });
    expect(container.textContent).toContain('People you follow');
    expect(cards(container)).toEqual([FOLLOW_A, FOLLOW_B]);
  });

  it('shows only a hint while the query is empty and there are no follows', () => {
    const { container } = render(PeopleResults, { props: { query: '' } });
    expect(container.textContent).toContain('Type a name to find people');
    expect(cards(container)).toEqual([]);
    expect(container.textContent).not.toContain('People you follow');
  });

  it('renders ranked results as profile cards, badging scored ones', () => {
    search.state = {
      term: 'lae',
      tooShort: false,
      busy: false,
      results: [contact(REAL, 'Laeserin'), contact(NOBODY, 'Laeserin (new)')],
      scores: new Map([[REAL, { pubkey: REAL, rank: 69, hops: 2, followers: 3409 }]])
    };
    const { container } = render(PeopleResults, { props: { query: 'lae' } });
    expect(cards(container)).toEqual([REAL, NOBODY]);
    expect(container.textContent).toContain('2 results found');
    const rows = container.querySelectorAll('[data-testid="people-result"]');
    const badge = rows[0].querySelector('[data-testid="people-wot-badge"]');
    expect(badge?.textContent).toContain('in web of trust');
    expect(badge?.getAttribute('title')).toBe('2 hops · 3409 followers');
    expect(rows[1].querySelector('[data-testid="people-wot-badge"]')).toBeNull();
    expect(container.textContent).not.toContain('People you follow');
  });

  it('shows the relay spinner while busy, even with partial results', () => {
    search.state = {
      term: 'lae',
      tooShort: false,
      busy: true,
      results: [contact(REAL, 'Laeserin')],
      scores: new Map()
    };
    const { container } = render(PeopleResults, { props: { query: 'lae' } });
    expect(container.textContent).toContain('Searching relays…');
    expect(cards(container)).toEqual([REAL]);
  });

  it('shows the empty state only once relays are done', () => {
    search.state = { term: 'zzz', tooShort: false, busy: true, results: [], scores: new Map() };
    const first = render(PeopleResults, { props: { query: 'zzz' } });
    expect(first.container.textContent).not.toContain('Nobody named');
    first.unmount();
    search.state = { ...search.state, busy: false };
    const { container } = render(PeopleResults, { props: { query: 'zzz' } });
    expect(container.textContent).toContain('Nobody named “zzz” found');
  });
});
