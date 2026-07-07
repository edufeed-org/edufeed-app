// @ts-nocheck
/**
 * Profile Tabs Config Tests
 *
 * Tests for the kind 30078 profile-tab configuration helpers:
 * - parseProfileTabsEvent: tags → {order, hidden}
 * - buildProfileTabsTags: {order, hidden} → tags
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  PROFILE_TAB_IDS,
  DEFAULT_TAB_ORDER,
  PROFILE_TABS_D_TAG,
  TAB_KINDS,
  parseProfileTabsEvent,
  buildProfileTabsTags,
  tabCountsFromEvents
} from '$lib/helpers/profile-tabs.js';

function tabsEvent(tags) {
  return {
    kind: 30078,
    pubkey: 'a'.repeat(64),
    created_at: 1000,
    content: '',
    tags: [['d', PROFILE_TABS_D_TAG], ...tags]
  };
}

describe('constants', () => {
  it('defines the eight profile tabs', () => {
    expect(PROFILE_TAB_IDS).toEqual([
      'posts',
      'content',
      'articles',
      'events',
      'polls',
      'bookmarks',
      'communities',
      'badges'
    ]);
  });

  it('default order covers every tab exactly once', () => {
    expect([...DEFAULT_TAB_ORDER].sort()).toEqual([...PROFILE_TAB_IDS].sort());
  });

  it('uses the edufeed profile-tabs d-tag', () => {
    expect(PROFILE_TABS_D_TAG).toBe('edufeed:profile-tabs');
  });

  it('maps timeline tabs to their event kinds', () => {
    expect(TAB_KINDS.content).toEqual([30142]);
    expect(TAB_KINDS.articles).toEqual([30023]);
    expect(TAB_KINDS.events).toEqual([31922, 31923]);
    expect(TAB_KINDS.polls).toEqual([1068]);
    expect(TAB_KINDS.bookmarks).toEqual([39701, 9802, 1111]);
  });
});

describe('parseProfileTabsEvent', () => {
  it('returns default order with nothing hidden for null event', () => {
    expect(parseProfileTabsEvent(null)).toEqual({ order: [...DEFAULT_TAB_ORDER], hidden: [] });
    expect(parseProfileTabsEvent(undefined)).toEqual({
      order: [...DEFAULT_TAB_ORDER],
      hidden: []
    });
  });

  it('reads tab order from tag order', () => {
    const event = tabsEvent([
      ['tab', 'badges'],
      ['tab', 'posts'],
      ['tab', 'content']
    ]);
    const { order } = parseProfileTabsEvent(event);
    expect(order.slice(0, 3)).toEqual(['badges', 'posts', 'content']);
  });

  it('collects hidden markers', () => {
    const event = tabsEvent([
      ['tab', 'posts'],
      ['tab', 'polls', 'hidden']
    ]);
    const { order, hidden } = parseProfileTabsEvent(event);
    expect(hidden).toEqual(['polls']);
    expect(order).toContain('polls');
  });

  it('drops unknown tab ids', () => {
    const event = tabsEvent([
      ['tab', 'posts'],
      ['tab', 'bogus'],
      ['tab', 'badges']
    ]);
    const { order, hidden } = parseProfileTabsEvent(event);
    expect(order).not.toContain('bogus');
    expect(hidden).not.toContain('bogus');
  });

  it('ignores reserved spell: ids for now', () => {
    const event = tabsEvent([
      ['tab', 'posts'],
      ['tab', 'spell:' + 'e'.repeat(64)]
    ]);
    const { order } = parseProfileTabsEvent(event);
    expect(order.some((id) => id.startsWith('spell:'))).toBe(false);
  });

  it('appends tabs missing from the event in default position, visible', () => {
    const event = tabsEvent([
      ['tab', 'badges'],
      ['tab', 'posts', 'hidden']
    ]);
    const { order, hidden } = parseProfileTabsEvent(event);
    expect([...order].sort()).toEqual([...PROFILE_TAB_IDS].sort());
    expect(order.slice(0, 2)).toEqual(['badges', 'posts']);
    // missing tabs keep their default relative order after the configured ones
    const appended = order.slice(2);
    expect(appended).toEqual(DEFAULT_TAB_ORDER.filter((id) => !['badges', 'posts'].includes(id)));
    expect(hidden).toEqual(['posts']);
  });

  it('deduplicates repeated tab ids, first occurrence wins', () => {
    const event = tabsEvent([
      ['tab', 'posts'],
      ['tab', 'posts', 'hidden']
    ]);
    const { order, hidden } = parseProfileTabsEvent(event);
    expect(order.filter((id) => id === 'posts')).toHaveLength(1);
    expect(hidden).not.toContain('posts');
  });
});

describe('buildProfileTabsTags', () => {
  it('emits d-tag plus one tab tag per id in order', () => {
    const tags = buildProfileTabsTags(['badges', 'posts'], []);
    expect(tags[0]).toEqual(['d', PROFILE_TABS_D_TAG]);
    expect(tags.slice(1)).toEqual([
      ['tab', 'badges'],
      ['tab', 'posts']
    ]);
  });

  it('marks hidden tabs with a third element', () => {
    const tags = buildProfileTabsTags(['posts', 'polls'], ['polls']);
    expect(tags).toContainEqual(['tab', 'polls', 'hidden']);
    expect(tags).toContainEqual(['tab', 'posts']);
  });

  it('round-trips through parseProfileTabsEvent', () => {
    const order = [
      'badges',
      'communities',
      'posts',
      'content',
      'articles',
      'events',
      'polls',
      'bookmarks'
    ];
    const hidden = ['polls', 'articles'];
    const tags = buildProfileTabsTags(order, hidden);
    const parsed = parseProfileTabsEvent({ kind: 30078, content: '', tags });
    expect(parsed.order).toEqual(order);
    expect([...parsed.hidden].sort()).toEqual([...hidden].sort());
  });
});

describe('tabCountsFromEvents', () => {
  it('buckets feed events into tab counts with posts as displayed-entry total', () => {
    const events = [
      { kind: 1, tags: [] },
      { kind: 1, tags: [] },
      { kind: 30142, tags: [] },
      { kind: 31922, tags: [] },
      { kind: 31923, tags: [] },
      { kind: 30023, tags: [] },
      { kind: 1068, tags: [] }
    ];
    expect(tabCountsFromEvents(events)).toEqual({
      posts: 7,
      content: 1,
      articles: 1,
      events: 2,
      polls: 1,
      bookmarks: 0
    });
  });

  it('counts bookmarks as displayed groups, not raw events', () => {
    const events = [
      // three web bookmarks of the SAME URL → one group
      { kind: 39701, created_at: 1, pubkey: 'a', tags: [['d', 'example.com/a']] },
      { kind: 39701, created_at: 2, pubkey: 'b', tags: [['d', 'example.com/a']] },
      { kind: 39701, created_at: 3, pubkey: 'c', tags: [['d', 'example.com/a']] },
      // URL highlight of a different page → second group
      { kind: 9802, created_at: 4, pubkey: 'a', tags: [['r', 'https://example.org/b']] },
      // event-ref highlight (a-tag) → third group (event-ref)
      {
        kind: 9802,
        created_at: 5,
        pubkey: 'a',
        tags: [['a', `30023:${'f'.repeat(64)}:my-article`]]
      },
      // comment on a nostr event (K != web) → displayed in no bookmark group
      { kind: 1111, created_at: 6, pubkey: 'a', tags: [['K', '30023']] }
    ];
    const counts = tabCountsFromEvents(events);
    expect(counts.bookmarks).toBe(3);
    // posts counts the same displayed entries (no raw-event inflation)
    expect(counts.posts).toBe(3);
  });

  it('excludes kind-1 replies from the posts count (feed shows root notes only)', () => {
    const events = [
      { kind: 1, tags: [] },
      { kind: 1, tags: [['e', 'f'.repeat(64), '', 'root']] },
      { kind: 1, tags: [['e', 'f'.repeat(64), '', 'reply']] }
    ];
    expect(tabCountsFromEvents(events).posts).toBe(1);
  });

  it('ignores unknown kinds and handles empty input', () => {
    expect(tabCountsFromEvents([{ kind: 9999, tags: [] }])).toEqual({
      posts: 0,
      content: 0,
      articles: 0,
      events: 0,
      polls: 0,
      bookmarks: 0
    });
    expect(tabCountsFromEvents([]).posts).toBe(0);
    expect(tabCountsFromEvents(null).posts).toBe(0);
  });
});
