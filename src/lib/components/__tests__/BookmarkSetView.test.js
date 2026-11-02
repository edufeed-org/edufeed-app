// @ts-nocheck
/**
 * BookmarkSetView — the detail page of a kind 30003 bookmark set (issue
 * a0838dc9): the shared ⋯ menu so a set can be shared like any content,
 * and a search / type filter over its items. Reordering moves positions in
 * the whole set, so it is offered only while nothing is filtered.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const doubles = vi.hoisted(() => ({ eventStore: null, activeUser: null }));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  await import('applesauce-common');
  const eventStore = new EventStore();
  eventStore.verifyEvent = () => true;
  doubles.eventStore = eventStore;
  const { EMPTY } = await import('rxjs');
  const pool = {
    request: () => EMPTY,
    subscription: () => EMPTY,
    group: () => ({ request: () => EMPTY, subscription: () => EMPTY }),
    relay: () => ({ request: () => EMPTY, subscription: () => EMPTY })
  };
  return { eventStore, pool };
});
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => doubles.activeUser
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map([[OTHER, { name: 'joerglohrer' }]])
}));
vi.mock('$lib/stores/personal-bookmarks.svelte.js', () => ({
  unbookmark: vi.fn(),
  updateBookmarkSet: vi.fn(),
  reorderBookmarkSetItem: vi.fn(),
  getBookmarkSetTitle: (e) => e.tags.find((t) => t[0] === 'title')?.[1] ?? '',
  getBookmarkSetIdentifier: (e) => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
}));
vi.mock('$lib/helpers/eventDeletion.js', () => ({ deleteEvent: vi.fn() }));
vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getAllLookupRelays: () => []
}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: vi.fn(),
  fetchEvents: vi.fn(() => ({ subscribe: () => ({ unsubscribe: () => {} }) }))
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ path) => path }));
vi.mock('../shared/FeedCard.svelte', async () => ({
  default: (await import('./fixtures/FeedCardTitleStub.svelte')).default
}));
vi.mock('../shared/EventContextMenu.svelte', async () => ({
  default: (await import('./fixtures/EventContextMenuStub.svelte')).default
}));

import BookmarkSetView from '../bookmarks/BookmarkSetView.svelte';

const id = (c) => c.repeat(64);
const note = (c, text) => ({
  id: id(c),
  kind: 1,
  pubkey: OTHER,
  created_at: 1,
  tags: [],
  content: text,
  sig: ''
});
const article = {
  id: id('9'),
  kind: 30023,
  pubkey: OTHER,
  created_at: 2,
  tags: [
    ['d', 'kirchenjahr'],
    ['title', 'Das Kirchenjahr']
  ],
  content: '',
  sig: ''
};
const set = () => ({
  id: id('5'),
  kind: 30003,
  pubkey: OWNER,
  created_at: 10,
  tags: [
    ['d', 'reli'],
    ['title', 'reli'],
    ['e', id('1')],
    ['e', id('2')],
    ['a', `30023:${OTHER}:kirchenjahr`]
  ],
  content: '',
  sig: ''
});

const titles = () => screen.queryAllByTestId('feed-card').map((el) => el.dataset.title);

describe('BookmarkSetView', () => {
  beforeEach(() => {
    doubles.activeUser = { pubkey: OWNER };
    for (const e of [note('1', 'Advent im Unterricht'), note('2', 'Ostern basteln'), article]) {
      doubles.eventStore.add(e);
    }
  });
  afterEach(() => cleanup());

  function mount() {
    const stored = doubles.eventStore.add(set());
    render(BookmarkSetView, { event: stored });
    flushSync();
    return stored;
  }

  it('offers the shared ⋯ menu for the set, with edit and delete for the owner only', () => {
    const stored = mount();
    expect(screen.getByTestId('event-context-menu').dataset.eventId).toBe(stored.id);
    expect(screen.getByTestId('menu-edit')).toBeTruthy();
    cleanup();
    doubles.activeUser = { pubkey: 'c'.repeat(64) };
    mount();
    expect(screen.getByTestId('event-context-menu')).toBeTruthy();
    expect(screen.queryByTestId('menu-edit')).toBeNull();
  });

  it('searches the items by text and author', async () => {
    mount();
    expect(titles()).toHaveLength(3);
    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'kirchen' } });
    expect(titles()).toEqual(['Das Kirchenjahr']);
    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'joerglohrer' } });
    expect(titles()).toHaveLength(3);
  });

  it('narrows to one type with the chips', async () => {
    mount();
    const chips = screen.getByTestId('list-item-filter').querySelectorAll('button');
    expect(chips.length).toBe(3); // Alle + two types
    await fireEvent.click(chips[2]);
    expect(titles()).toHaveLength(1);
  });

  it('hides reordering while filtered', async () => {
    mount();
    const moveUp = () => screen.queryAllByTitle(/nach oben|up/i);
    expect(moveUp().length).toBeGreaterThan(0);
    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'ostern' } });
    expect(moveUp()).toHaveLength(0);
  });
});
