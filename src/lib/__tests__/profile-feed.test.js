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
  filterFeedItems,
  FEED_CATEGORIES,
  pinnedPointersFromEvent,
  isEntryPinned,
  toggleSoloCategory,
  toggleHiddenCategory,
  effectiveActiveCategories
} from '$lib/helpers/profile-feed.js';

describe('FEED_CATEGORIES', () => {
  it('contains all expected categories', () => {
    const ids = FEED_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual(['notes', 'calendar', 'resources', 'articles', 'bookmarks', 'polls']);
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

  it('maps kind 9802 to bookmarks', () => {
    expect(kindToFeedCategory(9802)).toBe('bookmarks');
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

describe('filterFeedItems', () => {
  const mockEvents = [
    { id: '1', kind: 1, created_at: 100 },
    { id: '2', kind: 31922, created_at: 200 },
    { id: '3', kind: 30142, created_at: 300 },
    { id: '4', kind: 30023, created_at: 400 },
    { id: '5', kind: 39701, created_at: 500 },
    { id: '6', kind: 1, created_at: 600 }
  ];

  it('returns all items when all categories active', () => {
    const active = new Set(['notes', 'calendar', 'resources', 'articles', 'bookmarks']);
    const result = filterFeedItems(mockEvents, active);
    expect(result).toHaveLength(6);
  });

  it('filters out notes when notes category inactive', () => {
    const active = new Set(['calendar', 'resources', 'articles', 'bookmarks']);
    const result = filterFeedItems(mockEvents, active);
    expect(result).toHaveLength(4);
    expect(result.every((e) => e.kind !== 1)).toBe(true);
  });

  it('shows only calendar when only calendar active', () => {
    const active = new Set(['calendar']);
    const result = filterFeedItems(mockEvents, active);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe(31922);
  });

  it('returns empty array when no categories active', () => {
    const active = new Set();
    const result = filterFeedItems(mockEvents, active);
    expect(result).toHaveLength(0);
  });

  it('handles empty items array', () => {
    const active = new Set(['notes', 'calendar']);
    const result = filterFeedItems([], active);
    expect(result).toHaveLength(0);
  });

  it('excludes events with unknown kinds', () => {
    const events = [
      { id: '1', kind: 1, created_at: 100 },
      { id: '2', kind: 9999, created_at: 200 }
    ];
    const active = new Set(['notes', 'calendar', 'resources', 'articles', 'bookmarks']);
    const result = filterFeedItems(events, active);
    expect(result).toHaveLength(1);
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

describe('category solo/hide selection (issue #35)', () => {
  const ALL_IDS = FEED_CATEGORIES.map((c) => c.id);
  const EMPTY = { solo: null, hidden: [] };

  describe('toggleSoloCategory', () => {
    it('solos a category from the empty state', () => {
      expect(toggleSoloCategory(EMPTY, 'notes')).toEqual({ solo: 'notes', hidden: [] });
    });

    it('un-solos when toggling the solo category again', () => {
      expect(toggleSoloCategory({ solo: 'notes', hidden: [] }, 'notes')).toEqual(EMPTY);
    });

    it('switches solo to another category', () => {
      expect(toggleSoloCategory({ solo: 'notes', hidden: [] }, 'polls')).toEqual({
        solo: 'polls',
        hidden: []
      });
    });

    it('un-hides a hidden category when soloing it', () => {
      expect(toggleSoloCategory({ solo: null, hidden: ['notes', 'polls'] }, 'notes')).toEqual({
        solo: 'notes',
        hidden: ['polls']
      });
    });

    it('does not mutate the input selection', () => {
      const input = { solo: null, hidden: ['polls'] };
      toggleSoloCategory(input, 'notes');
      expect(input).toEqual({ solo: null, hidden: ['polls'] });
    });
  });

  describe('toggleHiddenCategory', () => {
    it('hides a visible category', () => {
      expect(toggleHiddenCategory(EMPTY, 'notes')).toEqual({ solo: null, hidden: ['notes'] });
    });

    it('un-hides a hidden category', () => {
      expect(toggleHiddenCategory({ solo: null, hidden: ['notes'] }, 'notes')).toEqual(EMPTY);
    });

    it('clears the solo when hiding the solo category', () => {
      expect(toggleHiddenCategory({ solo: 'notes', hidden: [] }, 'notes')).toEqual({
        solo: null,
        hidden: ['notes']
      });
    });

    it('keeps an unrelated solo intact', () => {
      expect(toggleHiddenCategory({ solo: 'polls', hidden: [] }, 'notes')).toEqual({
        solo: 'polls',
        hidden: ['notes']
      });
    });

    it('does not mutate the input selection', () => {
      const input = { solo: 'notes', hidden: [] };
      toggleHiddenCategory(input, 'notes');
      expect(input).toEqual({ solo: 'notes', hidden: [] });
    });
  });

  describe('effectiveActiveCategories', () => {
    it('returns all categories for the empty selection', () => {
      expect([...effectiveActiveCategories(EMPTY, ALL_IDS)]).toEqual(ALL_IDS);
    });

    it('returns only the solo category when solo is set', () => {
      expect([...effectiveActiveCategories({ solo: 'notes', hidden: [] }, ALL_IDS)]).toEqual([
        'notes'
      ]);
    });

    it('solo wins over the hidden list', () => {
      expect([...effectiveActiveCategories({ solo: 'notes', hidden: ['polls'] }, ALL_IDS)]).toEqual(
        ['notes']
      );
    });

    it('excludes hidden categories when no solo is set', () => {
      const active = effectiveActiveCategories({ solo: null, hidden: ['notes', 'polls'] }, ALL_IDS);
      expect([...active]).toEqual(['calendar', 'resources', 'articles', 'bookmarks']);
    });

    it('integrates with filterFeedItems', () => {
      const items = [{ kind: 1 }, { kind: 31922 }, { kind: 1068 }];
      const active = effectiveActiveCategories({ solo: null, hidden: ['notes'] }, ALL_IDS);
      expect(filterFeedItems(items, active)).toEqual([{ kind: 31922 }, { kind: 1068 }]);
    });
  });
});
