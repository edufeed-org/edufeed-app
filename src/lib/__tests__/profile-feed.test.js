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
import { kindToFeedCategory, filterFeedItems, FEED_CATEGORIES } from '$lib/helpers/profile-feed.js';

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
