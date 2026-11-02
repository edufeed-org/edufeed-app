// @ts-nocheck
/**
 * PeopleStrip — the compact people row above the content results of the
 * /discover "Alle" tab: the first few matches of usePeopleSearch() (members
 * of the deployment first), and a link to the full "Personen" tab.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import PeopleStrip from '../discover/PeopleStrip.svelte';

const P = (c) => c.repeat(64);

const search = vi.hoisted(() => ({ state: null, query: null }));
vi.mock('$lib/stores/people-search.svelte.js', () => ({
  usePeopleSearch: (getQuery) => {
    search.query = getQuery;
    return () => search.state;
  }
}));
vi.mock(
  '$lib/components/shared/ProfileCard.svelte',
  () => import('./fixtures/ProfileCardStub.svelte')
);
const followedBy = vi.hoisted(() => ({ map: new Map() }));
vi.mock('$lib/stores/followed-by.svelte.js', () => ({
  useFollowedBy: () => () => followedBy.map
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map([['f'.repeat(64), { display_name: 'Anna' }]])
}));
vi.mock('$lib/components/people/EducatorChips.svelte', () => import('./fixtures/EmptyStub.svelte'));
vi.mock('$lib/paraglide/messages', () => ({
  people_followed_by: ({ names }) => `Followed by ${names}`,
  people_followed_by_more: ({ names, count }) => `Followed by ${names} and ${count} more`,
  discover_people_strip_title: () => 'People',
  discover_people_strip_show_all: () => 'Show all people'
}));

const contact = (pubkey) => ({
  pubkey,
  name: null,
  display_name: null,
  picture: null,
  nip05: null,
  about: null
});
const cards = (container) =>
  [...container.querySelectorAll('[data-testid="people-strip-card"]')].map(
    (el) => el.dataset.pubkey
  );

beforeEach(() => {
  search.state = { term: 'paula', tooShort: false, busy: false, results: [], scores: new Map() };
});

describe('PeopleStrip', () => {
  it('shows the first three matches in result order and searches the given query', () => {
    search.state.results = [P('a'), P('b'), P('c'), P('d')].map(contact);
    const { container } = render(PeopleStrip, { props: { query: 'paula', onshowall: vi.fn() } });
    expect(search.query()).toBe('paula');
    expect(container.textContent).toContain('People');
    expect(cards(container)).toEqual([P('a'), P('b'), P('c')]);
  });

  it('hands over to the people tab', async () => {
    search.state.results = [contact(P('a'))];
    const onshowall = vi.fn();
    const { getByRole } = render(PeopleStrip, { props: { query: 'paula', onshowall } });
    await fireEvent.click(getByRole('button', { name: 'Show all people' }));
    expect(onshowall).toHaveBeenCalled();
  });

  it('renders nothing while there is nobody to show', () => {
    const { container } = render(PeopleStrip, { props: { query: 'paula', onshowall: vi.fn() } });
    expect(container.querySelector('[data-testid="people-strip"]')).toBeNull();
    search.state = { ...search.state, tooShort: true, results: [contact(P('a'))] };
    const second = render(PeopleStrip, { props: { query: 'p', onshowall: vi.fn() } });
    expect(second.container.querySelector('[data-testid="people-strip"]')).toBeNull();
  });
});
