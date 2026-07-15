// @ts-nocheck
/**
 * Profile Feed Tests
 *
 * Tests for the unified profile feed helper functions:
 * - kindToFeedCategory: maps event kinds to feed filter categories
 * - filterFeedItems: filters events by active feed categories
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  kindToFeedCategory,
  FEED_CATEGORIES,
  pinnedPointersFromEvent,
  isEntryPinned,
  toggleSelectedCategory,
  toggleHiddenCategory,
  effectiveActiveCategories,
  entryMatchesCategory,
  entryVisible
} from '$lib/helpers/profile-feed.js';

describe('FEED_CATEGORIES', () => {
  it('contains all expected categories', () => {
    const ids = FEED_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual([
      'notes',
      'calendar',
      'resources',
      'articles',
      'bookmarks',
      'highlights',
      'polls'
    ]);
  });

  it('each category has required fields', () => {
    for (const cat of FEED_CATEGORIES) {
      expect(cat).toHaveProperty('id');
      expect(cat).toHaveProperty('kinds');
      expect(cat.kinds.length).toBeGreaterThan(0);
    }
  });
});

describe('kindToFeedCategory', () => {
  it('maps kind 1 to notes', () => {
    expect(kindToFeedCategory(1)).toBe('notes');
  });

  it('maps kind 31922 to calendar', () => {
    expect(kindToFeedCategory(31922)).toBe('calendar');
  });

  it('maps kind 31923 to calendar', () => {
    expect(kindToFeedCategory(31923)).toBe('calendar');
  });

  it('maps kind 30142 to resources', () => {
    expect(kindToFeedCategory(30142)).toBe('resources');
  });

  it('maps kind 30023 to articles', () => {
    expect(kindToFeedCategory(30023)).toBe('articles');
  });

  it('maps kind 39701 to bookmarks', () => {
    expect(kindToFeedCategory(39701)).toBe('bookmarks');
  });

  it('maps kind 9802 to highlights', () => {
    expect(kindToFeedCategory(9802)).toBe('highlights');
  });

  it('maps kind 1111 to bookmarks', () => {
    expect(kindToFeedCategory(1111)).toBe('bookmarks');
  });

  it('maps kind 1068 to polls', () => {
    expect(kindToFeedCategory(1068)).toBe('polls');
  });

  it('returns null for unknown kinds', () => {
    expect(kindToFeedCategory(9999)).toBeNull();
    expect(kindToFeedCategory(0)).toBeNull();
  });
});

describe('entryMatchesCategory', () => {
  const authored = { type: 'articles', data: { kind: 30023 } };
  const shared = { type: 'articles', data: { kind: 30023 }, repost: { sharers: ['a'] } };
  const urlGroup = { type: 'bookmark-url', data: {} };
  const refGroup = { type: 'bookmark-ref', data: {} };

  it('matches the content category by entry type', () => {
    expect(entryMatchesCategory(authored, 'articles')).toBe(true);
    expect(entryMatchesCategory(authored, 'notes')).toBe(false);
  });

  it("matches 'shared' only for entries with repost metadata", () => {
    expect(entryMatchesCategory(shared, 'shared')).toBe(true);
    expect(entryMatchesCategory(authored, 'shared')).toBe(false);
  });

  it('a shared entry also matches its content category (dual membership)', () => {
    expect(entryMatchesCategory(shared, 'articles')).toBe(true);
  });

  it("group entries match 'bookmarks'", () => {
    expect(entryMatchesCategory(urlGroup, 'bookmarks')).toBe(true);
    expect(entryMatchesCategory(refGroup, 'bookmarks')).toBe(true);
    expect(entryMatchesCategory(urlGroup, 'shared')).toBe(false);
  });
});

describe('entryVisible', () => {
  const note = { type: 'notes', data: { kind: 1 } };
  const sharedNote = { type: 'notes', data: { kind: 1 }, repost: { sharers: ['a'] } };
  const sharedArticle = { type: 'articles', data: { kind: 30023 }, repost: { sharers: ['a'] } };
  const none = { selected: [], hidden: [] };

  it('shows everything with the empty selection', () => {
    expect(entryVisible(note, none)).toBe(true);
    expect(entryVisible(sharedArticle, none)).toBe(true);
  });

  it('selecting a content category includes shared entries of that category', () => {
    const sel = { selected: ['articles'], hidden: [] };
    expect(entryVisible(sharedArticle, sel)).toBe(true);
    expect(entryVisible(note, sel)).toBe(false);
  });

  it('shows entries matching ANY of multiple selected categories', () => {
    const sel = { selected: ['notes', 'articles'], hidden: [] };
    expect(entryVisible(note, sel)).toBe(true);
    expect(entryVisible(sharedArticle, sel)).toBe(true);
    expect(entryVisible({ type: 'polls', data: { kind: 1068 } }, sel)).toBe(false);
  });

  it("selecting 'shared' shows only repost entries, any target kind", () => {
    const sel = { selected: ['shared'], hidden: [] };
    expect(entryVisible(sharedNote, sel)).toBe(true);
    expect(entryVisible(sharedArticle, sel)).toBe(true);
    expect(entryVisible(note, sel)).toBe(false);
  });

  it('selection wins over hidden (hidden list ignored while a selection exists)', () => {
    const sel = { selected: ['articles'], hidden: ['shared'] };
    expect(entryVisible(sharedArticle, sel)).toBe(true);
  });

  it('hiding a content category also hides shared entries of it', () => {
    const sel = { selected: [], hidden: ['notes'] };
    expect(entryVisible(note, sel)).toBe(false);
    expect(entryVisible(sharedNote, sel)).toBe(false);
    expect(entryVisible(sharedArticle, sel)).toBe(true);
  });

  it("hiding 'shared' hides every repost entry but keeps authored content", () => {
    const sel = { selected: [], hidden: ['shared'] };
    expect(entryVisible(sharedNote, sel)).toBe(false);
    expect(entryVisible(sharedArticle, sel)).toBe(false);
    expect(entryVisible(note, sel)).toBe(true);
  });
});

describe('pinnedPointersFromEvent', () => {
  it('extracts e and a pointers preserving order', () => {
    const pinList = {
      kind: 10001,
      tags: [
        ['e', 'e1'.padEnd(64, '0'), 'wss://relay.example'],
        ['a', '30142:abc:my-resource'],
        ['e', 'e2'.padEnd(64, '0')],
        ['d', 'noise']
      ]
    };
    const pointers = pinnedPointersFromEvent(pinList);
    expect(pointers).toEqual([
      { type: 'e', value: 'e1'.padEnd(64, '0') },
      { type: 'a', value: '30142:abc:my-resource' },
      { type: 'e', value: 'e2'.padEnd(64, '0') }
    ]);
  });

  it('returns empty for missing event', () => {
    expect(pinnedPointersFromEvent(null)).toEqual([]);
    expect(pinnedPointersFromEvent(undefined)).toEqual([]);
  });
});

describe('isEntryPinned', () => {
  const pointers = [
    { type: 'e', value: 'pinned-id' },
    { type: 'a', value: '30142:author:res-1' }
  ];

  it('matches regular events by id', () => {
    const entry = { type: 'notes', data: { id: 'pinned-id', kind: 1, pubkey: 'author', tags: [] } };
    expect(isEntryPinned(entry, pointers)).toBe(true);
  });

  it('matches addressable events by coordinate', () => {
    const entry = {
      type: 'resources',
      data: { id: 'other-id', kind: 30142, pubkey: 'author', tags: [['d', 'res-1']] }
    };
    expect(isEntryPinned(entry, pointers)).toBe(true);
  });

  it('does not match unpinned events', () => {
    const entry = { type: 'notes', data: { id: 'other', kind: 1, pubkey: 'author', tags: [] } };
    expect(isEntryPinned(entry, pointers)).toBe(false);
  });

  it('ignores bookmark group entries (no underlying single event)', () => {
    const entry = { type: 'bookmark-url', data: { url: 'https://example.com' } };
    expect(isEntryPinned(entry, pointers)).toBe(false);
  });

  it('handles empty pointer list', () => {
    const entry = { type: 'notes', data: { id: 'pinned-id', kind: 1, pubkey: 'a', tags: [] } };
    expect(isEntryPinned(entry, [])).toBe(false);
  });
});

describe('category select/hide selection (issues #35, multi-select)', () => {
  const ALL_IDS = FEED_CATEGORIES.map((c) => c.id);
  const EMPTY = { selected: [], hidden: [] };

  describe('toggleSelectedCategory', () => {
    it('selects a category from the empty state', () => {
      expect(toggleSelectedCategory(EMPTY, 'notes')).toEqual({ selected: ['notes'], hidden: [] });
    });

    it('deselects when toggling a selected category again', () => {
      expect(toggleSelectedCategory({ selected: ['notes'], hidden: [] }, 'notes')).toEqual(EMPTY);
    });

    it('adds a second category to the selection (multi-select)', () => {
      expect(toggleSelectedCategory({ selected: ['notes'], hidden: [] }, 'polls')).toEqual({
        selected: ['notes', 'polls'],
        hidden: []
      });
    });

    it('removes only the toggled category from a multi-selection', () => {
      expect(toggleSelectedCategory({ selected: ['notes', 'polls'], hidden: [] }, 'notes')).toEqual(
        { selected: ['polls'], hidden: [] }
      );
    });

    it('un-hides a hidden category when selecting it', () => {
      expect(toggleSelectedCategory({ selected: [], hidden: ['notes', 'polls'] }, 'notes')).toEqual(
        {
          selected: ['notes'],
          hidden: ['polls']
        }
      );
    });

    it('does not mutate the input selection', () => {
      const input = { selected: [], hidden: ['polls'] };
      toggleSelectedCategory(input, 'notes');
      expect(input).toEqual({ selected: [], hidden: ['polls'] });
    });
  });

  describe('toggleHiddenCategory', () => {
    it('hides a visible category', () => {
      expect(toggleHiddenCategory(EMPTY, 'notes')).toEqual({ selected: [], hidden: ['notes'] });
    });

    it('un-hides a hidden category', () => {
      expect(toggleHiddenCategory({ selected: [], hidden: ['notes'] }, 'notes')).toEqual(EMPTY);
    });

    it('removes the category from the selection when hiding it', () => {
      expect(toggleHiddenCategory({ selected: ['notes', 'polls'], hidden: [] }, 'notes')).toEqual({
        selected: ['polls'],
        hidden: ['notes']
      });
    });

    it('keeps unrelated selections intact', () => {
      expect(toggleHiddenCategory({ selected: ['polls'], hidden: [] }, 'notes')).toEqual({
        selected: ['polls'],
        hidden: ['notes']
      });
    });

    it('does not mutate the input selection', () => {
      const input = { selected: ['notes'], hidden: [] };
      toggleHiddenCategory(input, 'notes');
      expect(input).toEqual({ selected: ['notes'], hidden: [] });
    });
  });

  describe('effectiveActiveCategories', () => {
    it('returns all categories for the empty selection', () => {
      expect([...effectiveActiveCategories(EMPTY, ALL_IDS)]).toEqual(ALL_IDS);
    });

    it('returns only the selected categories when a selection exists', () => {
      expect([
        ...effectiveActiveCategories({ selected: ['notes', 'polls'], hidden: [] }, ALL_IDS)
      ]).toEqual(['notes', 'polls']);
    });

    it('selection wins over the hidden list', () => {
      expect([
        ...effectiveActiveCategories({ selected: ['notes'], hidden: ['polls'] }, ALL_IDS)
      ]).toEqual(['notes']);
    });

    it('excludes hidden categories when nothing is selected', () => {
      const active = effectiveActiveCategories(
        { selected: [], hidden: ['notes', 'polls'] },
        ALL_IDS
      );
      expect([...active]).toEqual(['calendar', 'resources', 'articles', 'bookmarks', 'highlights']);
    });
  });
});
