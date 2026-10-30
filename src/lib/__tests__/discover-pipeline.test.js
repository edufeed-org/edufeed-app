// @ts-nocheck
/** @vitest-environment node */
// The discover content pipeline: raw items → relay filter → author filter →
// text search → sort. Pure functions over `{type, data}` items; the page's
// $derived chain calls them one step at a time.
import { describe, it, expect } from 'vitest';
import { addSeenRelay } from 'applesauce-core/helpers/relays';
import {
  buildRawItems,
  buildCommunityRawItems,
  filterByRelay,
  filterByAuthors,
  filterBySearch,
  resolveSortBy,
  sortItems,
  getItemTimestamp,
  getItemRankKey,
  joinedFilterState,
  tierByMembers
} from '$lib/helpers/discover-pipeline.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const M = 'c'.repeat(64);

/** @param {Partial<any>} over */
const article = (over = {}) => ({
  id: over.id ?? 'art',
  kind: 30023,
  pubkey: A,
  created_at: 100,
  tags: [
    ['d', 'x'],
    ['title', 'Open Science'],
    ['published_at', '150']
  ],
  content: '',
  ...over
});
const amb = (over = {}) => ({
  id: 'amb',
  kind: 30142,
  pubkey: A,
  identifier: 'r1',
  name: 'Mathe Arbeitsblatt',
  publishedDate: 200,
  ...over
});
const board = (over = {}) => ({ id: 'board', kind: 30301, pubkey: B, created_at: 300, ...over });
const calendar = (over = {}) => ({
  id: 'ev',
  kind: 31923,
  pubkey: B,
  title: 'Barcamp',
  start: 400,
  ...over
});

const allShown = () => true;
const allAllowed = () => true;

describe('buildRawItems', () => {
  const sources = {
    calendarEvents: [calendar()],
    ambResources: [amb()],
    articles: [article()],
    kanbanBoards: [board()]
  };

  it('maps every enabled source to typed items, in events → learning → articles → boards order', () => {
    const items = buildRawItems(sources, { showsType: allShown, isAllowedAuthor: allAllowed });
    expect(items.map((i) => i.type)).toEqual(['event', 'amb', 'article', 'board']);
  });

  it('only includes the types the current tab shows', () => {
    const items = buildRawItems(sources, {
      showsType: (type) => type === 'articles',
      isAllowedAuthor: allAllowed
    });
    expect(items.map((i) => i.type)).toEqual(['article']);
  });

  it('drops authors outside the curated set per relay category', () => {
    const items = buildRawItems(sources, {
      showsType: allShown,
      isAllowedAuthor: (category, pubkey) => !(category === 'kanban' && pubkey === B)
    });
    expect(items.map((i) => i.type)).toEqual(['event', 'amb', 'article']);
  });

  it('restricts learning resources to the NIP-50 result ids while a search is active, ignoring the curated set', () => {
    const items = buildRawItems(
      { ...sources, ambResources: [amb({ id: 'hit', pubkey: B }), amb({ id: 'miss' })] },
      {
        showsType: (type) => type === 'learning',
        isAllowedAuthor: () => false,
        learningSearchIds: new Set(['hit'])
      }
    );
    expect(items.map((i) => i.data.id)).toEqual(['hit']);
  });

  it('lets matched authors through the NIP-50 id gate and the curated set', () => {
    const items = buildRawItems(
      {
        ...sources,
        ambResources: [amb({ id: 'hit', pubkey: B }), amb({ id: 'mine', pubkey: M })],
        articles: [article({ id: 'art-m', pubkey: M })]
      },
      {
        showsType: (type) => type === 'learning' || type === 'articles',
        isAllowedAuthor: () => false,
        learningSearchIds: new Set(['hit']),
        matchedAuthors: new Set([M])
      }
    );
    expect(items.map((i) => i.data.id)).toEqual(['hit', 'mine', 'art-m']);
  });

  it('matches search results by the wrapped event id as well', () => {
    const items = buildRawItems(
      { ...sources, ambResources: [amb({ id: 'formatted', event: { id: 'raw' } })] },
      {
        showsType: (type) => type === 'learning',
        isAllowedAuthor: allAllowed,
        learningSearchIds: new Set(['raw'])
      }
    );
    expect(items.map((i) => i.data.id)).toEqual(['formatted']);
  });
});

describe('buildCommunityRawItems', () => {
  it('keeps only the types the tab shows and never applies the curated set', () => {
    const items = buildCommunityRawItems([article(), board()], 'all', {
      showsType: (type) => type === 'articles'
    });
    expect(items.map((i) => i.type)).toEqual(['article']);
  });

  it('intersects learning items with the active search on the learning tab', () => {
    const scoped = [
      { id: 'hit', kind: 30142, pubkey: A, tags: [['d', 'r1']], content: '{}', created_at: 1 },
      { id: 'miss', kind: 30142, pubkey: A, tags: [['d', 'r2']], content: '{}', created_at: 1 }
    ];
    const items = buildCommunityRawItems(scoped, 'learning', {
      showsType: (type) => type === 'learning',
      learningSearchIds: new Set(['hit'])
    });
    expect(items.map((i) => i.data.event?.id ?? i.data.id)).toEqual(['hit']);
  });
});

describe('filters', () => {
  it('filterByRelay keeps items seen on the relay, comparing normalized urls', () => {
    const seen = article({ id: 'seen' });
    addSeenRelay(seen, 'wss://relay.example/');
    const items = [
      { type: 'article', data: seen },
      { type: 'article', data: article({ id: 'unseen' }) }
    ];
    expect(filterByRelay(items, null)).toBe(items);
    expect(filterByRelay(items, 'wss://RELAY.example').map((i) => i.data.id)).toEqual(['seen']);
  });

  it('filterByRelay reads provenance from the wrapped raw event', () => {
    const raw = calendar();
    addSeenRelay(raw, 'wss://cal.example/');
    const items = [{ type: 'event', data: { ...calendar(), rawEvent: raw } }];
    expect(filterByRelay(items, 'wss://cal.example')).toHaveLength(1);
  });

  it('filterByAuthors keeps the selected authors only', () => {
    const items = [
      { type: 'article', data: article() },
      { type: 'board', data: board() }
    ];
    expect(filterByAuthors(items, [])).toBe(items);
    expect(filterByAuthors(items, [B]).map((i) => i.type)).toEqual(['board']);
  });

  it('filterBySearch matches title and author name, and skips while a learning search owns the query', () => {
    const items = [
      { type: 'article', data: article({ id: 'title' }) },
      { type: 'article', data: article({ id: 'author', pubkey: B, tags: [['title', 'x']] }) },
      { type: 'article', data: article({ id: 'none', tags: [['title', 'x']] }) }
    ];
    const profiles = new Map([[B, { name: 'Open Educator' }]]);
    expect(filterBySearch(items, '  ', { profiles })).toBe(items);
    expect(filterBySearch(items, 'open', { profiles }).map((i) => i.data.id)).toEqual([
      'title',
      'author'
    ]);
    expect(
      filterBySearch(items, 'open', {
        profiles,
        contentType: 'learning',
        isLearningSearchActive: true
      })
    ).toBe(items);
  });

  it('filterBySearch lets relay-searched learning items through on the all tab', () => {
    const items = [
      { type: 'amb', data: amb({ name: 'zzz' }) },
      { type: 'article', data: article({ tags: [['title', 'zzz']] }) }
    ];
    const out = filterBySearch(items, 'open', {
      profiles: new Map(),
      contentType: 'all',
      isLearningSearchActive: true
    });
    expect(out.map((i) => i.type)).toEqual(['amb']);
  });
});

describe('matched authors in the text search', () => {
  it('keeps every item of a matched author, whatever its text says', () => {
    const items = [
      { type: 'article', data: article({ id: 'm', pubkey: M, tags: [['title', 'zzz']] }) },
      { type: 'article', data: article({ id: 'x', tags: [['title', 'zzz']] }) }
    ];
    const out = filterBySearch(items, 'paula', {
      profiles: new Map(),
      matchedAuthors: new Set([M])
    });
    expect(out.map((i) => i.data.id)).toEqual(['m']);
  });
});

describe('tierByMembers', () => {
  const item = (id, pubkey) => ({ type: 'article', data: article({ id, pubkey }) });

  it('puts matched members, then other members, then everyone else — order kept inside', () => {
    const items = [item('x1', A), item('m1', B), item('p1', M), item('x2', A), item('p2', M)];
    const out = tierByMembers(items, { matched: new Set([M]), members: new Set([M, B]) });
    expect(out.map((i) => i.data.id)).toEqual(['p1', 'p2', 'm1', 'x1', 'x2']);
  });

  it('returns the input untouched when no item is by a member', () => {
    const items = [item('x1', A)];
    expect(tierByMembers(items, { matched: new Set(), members: new Set([B]) })).toBe(items);
  });
});

describe('sorting', () => {
  it('getItemTimestamp uses the published date of articles, the AMB publishedDate, created_at of boards and start of events', () => {
    expect(getItemTimestamp({ type: 'article', data: article() })).toBe(150);
    expect(getItemTimestamp({ type: 'amb', data: amb() })).toBe(200);
    expect(getItemTimestamp({ type: 'board', data: board() })).toBe(300);
    expect(getItemTimestamp({ type: 'event', data: calendar() })).toBe(400);
  });

  it('getItemRankKey matches the search rank key (kind:pubkey:identifier, else id)', () => {
    expect(getItemRankKey({ type: 'amb', data: amb() })).toBe(`30142:${A}:r1`);
    expect(getItemRankKey({ type: 'amb', data: { id: 'plain' } })).toBe('plain');
  });

  it('resolveSortBy forces oldest on events and drops relevance when no search ranks it', () => {
    expect(resolveSortBy('events', 'newest', false)).toBe('oldest');
    expect(resolveSortBy('learning', 'relevance', true)).toBe('relevance');
    expect(resolveSortBy('learning', 'relevance', false)).toBe('newest');
    expect(resolveSortBy('articles', 'oldest', false)).toBe('oldest');
  });

  it('sortItems orders by timestamp, or by rank then newest, without mutating the input', () => {
    const items = [
      { type: 'article', data: article({ id: 'old', tags: [['published_at', '10']] }) },
      { type: 'board', data: board({ id: 'new', created_at: 30 }) },
      { type: 'amb', data: amb({ id: 'mid', identifier: 'mid', publishedDate: 20 }) }
    ];
    const snapshot = [...items];
    expect(sortItems(items, 'newest').map((i) => i.data.id)).toEqual(['new', 'mid', 'old']);
    expect(sortItems(items, 'oldest').map((i) => i.data.id)).toEqual(['old', 'mid', 'new']);
    const rank = new Map([[`30142:${A}:mid`, 0]]);
    expect(sortItems(items, 'relevance', rank).map((i) => i.data.id)).toEqual([
      'mid',
      'new',
      'old'
    ]);
    expect(items).toEqual(snapshot);
  });
});

describe('joinedFilterState', () => {
  it('is null unless the "joined" community filter is active with no communities', () => {
    expect(joinedFilterState(null, 0, 'ready')).toBeNull();
    expect(joinedFilterState('c'.repeat(64), 0, 'ready')).toBeNull();
    expect(joinedFilterState('joined', 3, 'loading')).toBeNull();
  });

  it('tells loading, really empty and unavailable apart', () => {
    expect(joinedFilterState('joined', 0, 'loading')).toBe('loading');
    expect(joinedFilterState('joined', 0, 'ready')).toBe('empty');
    expect(joinedFilterState('joined', 0, 'unavailable')).toBe('unavailable');
  });
});
