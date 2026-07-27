/**
 * Tests for src/lib/helpers/communityContent.js
 *
 * Covers mapCommunityItemsToRawItems — the pure helper that converts
 * CommunityActivityModel output (raw events with optional repost metadata)
 * into the {type, data} rawItems shape the discover-page pipeline expects.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  mapCommunityItemsToRawItems,
  hasDisplayableCommunityProfile
} from '$lib/helpers/communityContent.js';

/** @param {Partial<{id:string,kind:number,pubkey:string,tags:string[][],created_at:number,content:string}>} o */
function ev(o = {}) {
  return {
    id: o.id || Math.random().toString(36).slice(2),
    kind: o.kind ?? 1,
    pubkey: o.pubkey || 'author',
    tags: o.tags || [],
    created_at: o.created_at ?? 1700000000,
    content: o.content || ''
  };
}

describe('mapCommunityItemsToRawItems', () => {
  it('maps kind 30142 to type "amb" with formatAMBResource transform applied', () => {
    const amb = ev({
      kind: 30142,
      tags: [
        ['d', 'res-1'],
        ['name', 'My Resource']
      ]
    });

    const result = mapCommunityItemsToRawItems([amb], 'all');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('amb');
    expect(result[0].data.id).toBe(amb.id);
    expect(result[0].data.pubkey).toBe(amb.pubkey);
    // formatAMBResource hydrates the resource with a name field from tags
    expect(result[0].data.name).toBe('My Resource');
  });

  it('maps kinds 31922/31923 to type "event" with calendar metadata applied', () => {
    const allDay = ev({
      kind: 31922,
      tags: [
        ['d', 'cal-1'],
        ['title', 'All Day'],
        ['start', '2026-06-01']
      ]
    });
    const timed = ev({
      kind: 31923,
      tags: [
        ['d', 'cal-2'],
        ['title', 'Timed'],
        ['start', '1717200000']
      ]
    });

    const result = mapCommunityItemsToRawItems([allDay, timed], 'all');

    expect(result).toHaveLength(2);
    for (const item of result) {
      expect(item.type).toBe('event');
      // getCalendarEventMetadata hydrates a 'title' field
      expect(item.data.title).toBeTruthy();
    }
  });

  it('maps kind 30023 to type "article" without transform', () => {
    const article = ev({ kind: 30023, content: '# hi' });

    const result = mapCommunityItemsToRawItems([article], 'all');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('article');
    expect(result[0].data.id).toBe(article.id);
    expect(result[0].data.content).toBe('# hi');
  });

  it('maps kind 30301 to type "board" without transform', () => {
    const board = ev({ kind: 30301, tags: [['title', 'Sprint Board']] });

    const result = mapCommunityItemsToRawItems([board], 'all');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('board');
    expect(result[0].data.id).toBe(board.id);
  });

  it('contentType="learning" returns only AMB resources', () => {
    const items = [
      ev({ id: 'amb1', kind: 30142, tags: [['d', 'a']] }),
      ev({ id: 'art1', kind: 30023 }),
      ev({ id: 'cal1', kind: 31923, tags: [['start', '1717200000']] }),
      ev({ id: 'board1', kind: 30301 })
    ];

    const result = mapCommunityItemsToRawItems(items, 'learning');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('amb');
    expect(result[0].data.id).toBe('amb1');
  });

  it('contentType="articles" returns only articles', () => {
    const items = [
      ev({ id: 'amb1', kind: 30142, tags: [['d', 'a']] }),
      ev({ id: 'art1', kind: 30023 }),
      ev({ id: 'art2', kind: 30023 })
    ];

    const result = mapCommunityItemsToRawItems(items, 'articles');

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.type === 'article')).toBe(true);
  });

  it('contentType="events" returns only calendar events (kinds 31922 + 31923)', () => {
    const items = [
      ev({ id: 'amb1', kind: 30142, tags: [['d', 'a']] }),
      ev({ id: 'cal1', kind: 31922, tags: [['start', '2026-06-01']] }),
      ev({ id: 'cal2', kind: 31923, tags: [['start', '1717200000']] }),
      ev({ id: 'art1', kind: 30023 })
    ];

    const result = mapCommunityItemsToRawItems(items, 'events');

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.type === 'event')).toBe(true);
  });

  it('contentType="boards" returns only kanban boards', () => {
    const items = [
      ev({ id: 'amb1', kind: 30142, tags: [['d', 'a']] }),
      ev({ id: 'board1', kind: 30301 }),
      ev({ id: 'board2', kind: 30301 })
    ];

    const result = mapCommunityItemsToRawItems(items, 'boards');

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.type === 'board')).toBe(true);
  });

  it('drops kinds that have no discover slot (e.g. wikis 30818, threads 11)', () => {
    const items = [
      ev({ id: 'amb1', kind: 30142, tags: [['d', 'a']] }),
      ev({ id: 'wiki1', kind: 30818 }),
      ev({ id: 'thread1', kind: 11 })
    ];

    const result = mapCommunityItemsToRawItems(items, 'all');

    expect(result).toHaveLength(1);
    expect(result[0].data.id).toBe('amb1');
  });

  it('returns empty array for empty input', () => {
    expect(mapCommunityItemsToRawItems([], 'all')).toEqual([]);
    expect(mapCommunityItemsToRawItems([], 'learning')).toEqual([]);
  });

  it('preserves repost metadata (_sharedBy, _allSharers) through the transform', () => {
    const amb = {
      ...ev({ kind: 30142, tags: [['d', 'shared-res']] }),
      _sharedBy: 'sharer1',
      _allSharers: ['sharer1', 'sharer2']
    };

    const result = mapCommunityItemsToRawItems([amb], 'all');

    expect(result).toHaveLength(1);
    expect(result[0].data._sharedBy).toBe('sharer1');
    expect(result[0].data._allSharers).toEqual(['sharer1', 'sharer2']);
  });
});

describe('hasDisplayableCommunityProfile', () => {
  it('rejects a missing profile (no kind 0 found)', () => {
    expect(hasDisplayableCommunityProfile(undefined)).toBe(false);
    expect(hasDisplayableCommunityProfile(null)).toBe(false);
  });

  it('rejects a profile without any name', () => {
    expect(hasDisplayableCommunityProfile({ about: 'A community for math teachers' })).toBe(false);
    expect(hasDisplayableCommunityProfile({ name: '', about: 'A community' })).toBe(false);
    expect(hasDisplayableCommunityProfile({ name: '  ', about: 'A community' })).toBe(false);
    expect(hasDisplayableCommunityProfile({})).toBe(false);
  });

  it('accepts a profile with a name but no description (e.g. EKKW RPI, relilab)', () => {
    expect(hasDisplayableCommunityProfile({ name: 'relilab' })).toBe(true);
    expect(hasDisplayableCommunityProfile({ name: 'relilab', about: '' })).toBe(true);
  });

  it('accepts a profile with name and description', () => {
    expect(
      hasDisplayableCommunityProfile({ name: 'Mathe AG', about: 'A community for math teachers' })
    ).toBe(true);
  });

  it('accepts display_name as the name field', () => {
    expect(hasDisplayableCommunityProfile({ display_name: 'Mathe AG' })).toBe(true);
  });

  it('rejects non-string name values from malformed kind 0 content', () => {
    expect(hasDisplayableCommunityProfile({ name: 42 })).toBe(false);
    expect(hasDisplayableCommunityProfile({ name: { text: 'x' } })).toBe(false);
  });
});
