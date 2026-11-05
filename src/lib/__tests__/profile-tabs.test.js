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
  tabCountsFromEvents,
  tabForPostsStat,
  autoTabIds,
  withAutoTabs,
  tabsToSave,
  PROFILE_CONTENT_KINDS
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
  it('defines the ten profile tabs', () => {
    expect(PROFILE_TAB_IDS).toEqual([
      'posts',
      'content',
      'articles',
      'wikis',
      'publications',
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
    expect(TAB_KINDS.publications).toEqual([30040]);
    expect(TAB_KINDS.wikis).toEqual([30818]);
  });

  // Publications have their own tab only: no feed mixes them in.
  it('loads publications on the profile without adding them to the feeds', () => {
    expect(PROFILE_CONTENT_KINDS).toContain(30040);
    expect(PROFILE_CONTENT_KINDS).toContain(30818);
    expect(PROFILE_CONTENT_KINDS).toEqual(expect.arrayContaining(TAB_KINDS.bookmarks));
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
      'wikis',
      'publications',
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
      bookmarks: 0,
      publications: 0,
      wikis: 0
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
      bookmarks: 0,
      publications: 0,
      wikis: 0
    });
    expect(tabCountsFromEvents([]).posts).toBe(0);
    expect(tabCountsFromEvents(null).posts).toBe(0);
  });
});

describe('tabForPostsStat', () => {
  it('picks the mixed posts tab by default (the count sums that feed)', () => {
    expect(tabForPostsStat(parseProfileTabsEvent(null))).toBe('posts');
  });

  it('keeps the posts tab when the owner only reordered tabs', () => {
    const config = parseProfileTabsEvent(
      tabsEvent([
        ['tab', 'badges'],
        ['tab', 'posts']
      ])
    );
    expect(tabForPostsStat(config)).toBe('posts');
  });

  it('falls back to the first visible per-type content tab when posts is hidden', () => {
    const config = parseProfileTabsEvent(
      tabsEvent([
        ['tab', 'communities'],
        ['tab', 'posts', 'hidden'],
        ['tab', 'articles'],
        ['tab', 'content']
      ])
    );
    expect(tabForPostsStat(config)).toBe('articles');
  });

  it('returns null when no tab shows any of the counted content', () => {
    const config = parseProfileTabsEvent(
      tabsEvent(
        ['posts', 'content', 'articles', 'events', 'polls', 'bookmarks'].map((id) => [
          'tab',
          id,
          'hidden'
        ])
      )
    );
    expect(tabForPostsStat(config)).toBeNull();
  });
});

describe('publications tab (kind 30040)', () => {
  it('counts publications in their own tab, not in the posts total', () => {
    const counts = tabCountsFromEvents([
      { kind: 30040, pubkey: 'a', tags: [['d', 'one']] },
      { kind: 30040, pubkey: 'a', tags: [['d', 'two']] },
      { kind: 30023, tags: [] }
    ]);
    expect(counts.publications).toBe(2);
    expect(counts.posts).toBe(1);
  });

  // NKBIP-01: chapters (sub-indexes) of a loaded book are listed under it,
  // so the tab counts books, not every chapter.
  it('counts a book with its chapters once', () => {
    const P = 'a'.repeat(64);
    const pub = (d, tags = []) => ({
      kind: 30040,
      pubkey: P,
      created_at: 1,
      tags: [['d', d], ...tags]
    });
    const counts = tabCountsFromEvents([
      pub('book', [
        ['a', `30040:${P}:ch1`],
        ['a', `30040:${P}:ch2`]
      ]),
      pub('ch1'),
      pub('ch2'),
      pub('other')
    ]);
    expect(counts.publications).toBe(2);
  });

  it('is an auto tab while the owner has not placed it explicitly', () => {
    expect(autoTabIds(null)).toEqual(['publications', 'wikis']);
    expect(autoTabIds(tabsEvent([['tab', 'posts']]))).toEqual(['publications', 'wikis']);
    expect(autoTabIds(tabsEvent([['tab', 'publications']]))).toEqual(['wikis']);
    expect(autoTabIds(tabsEvent([['tab', 'publications', 'hidden']]))).toEqual(['wikis']);
  });

  it('hides an auto tab without entries and shows it once there are some', () => {
    const config = parseProfileTabsEvent(null);
    const auto = autoTabIds(null);
    expect(withAutoTabs(config, auto, { publications: 0 }).hidden).toEqual([
      'publications',
      'wikis'
    ]);
    expect(withAutoTabs(config, auto, {}).hidden).toEqual(['publications', 'wikis']);
    expect(withAutoTabs(config, auto, { publications: 3, wikis: 1 }).hidden).toEqual([]);
    // order is untouched
    expect(withAutoTabs(config, auto, {}).order).toEqual(config.order);
  });

  it('an explicit choice wins over the entry count', () => {
    const event = tabsEvent([['tab', 'publications']]);
    const shown = withAutoTabs(parseProfileTabsEvent(event), autoTabIds(event), {});
    expect(shown.hidden).not.toContain('publications');

    const hiddenEvent = tabsEvent([['tab', 'publications', 'hidden']]);
    const hidden = withAutoTabs(parseProfileTabsEvent(hiddenEvent), autoTabIds(hiddenEvent), {
      publications: 5
    });
    expect(hidden.hidden).toContain('publications');
  });

  it('does not save an empty auto tab the owner left hidden', () => {
    const order = [...DEFAULT_TAB_ORDER];
    const saved = tabsToSave(order, ['publications', 'polls'], ['publications'], {});
    expect(saved.order).not.toContain('publications');
    expect(saved.hidden).toEqual(['polls']);
    // so it stays an auto tab after the round trip
    const event = tabsEvent(buildProfileTabsTags(saved.order, saved.hidden).slice(1));
    expect(autoTabIds(event)).toEqual(['publications']);
  });

  it('saves the auto tab once the owner shows it, or hides it while it has entries', () => {
    const order = [...DEFAULT_TAB_ORDER];
    expect(tabsToSave(order, [], ['publications'], {}).order).toContain('publications');
    const hiddenWithEntries = tabsToSave(order, ['publications'], ['publications'], {
      publications: 2
    });
    expect(hiddenWithEntries.order).toContain('publications');
    expect(hiddenWithEntries.hidden).toEqual(['publications']);
  });
});

// NIP-54 wiki articles (kind 30818): an own tab, like publications — few
// people write wikis, so it shows only once there are entries.
describe('wikis tab (kind 30818)', () => {
  it('counts wikis in their own tab, not in the posts total', () => {
    const counts = tabCountsFromEvents([
      { kind: 30818, pubkey: 'a', tags: [['d', 'one']] },
      { kind: 30818, pubkey: 'a', tags: [['d', 'two']] },
      { kind: 30023, tags: [] }
    ]);
    expect(counts.wikis).toBe(2);
    expect(counts.posts).toBe(1);
  });

  it('shows up by itself once the profile has wikis', () => {
    const config = parseProfileTabsEvent(null);
    const auto = autoTabIds(null);
    expect(withAutoTabs(config, auto, { wikis: 0 }).hidden).toContain('wikis');
    expect(withAutoTabs(config, auto, { wikis: 4 }).hidden).not.toContain('wikis');
  });

  // An owner who saved a tab order before the wikis tab existed has no
  // `tab` tag for it: it stays an auto tab instead of being forced on.
  it('stays an auto tab for tab configs saved before it existed', () => {
    const event = tabsEvent([
      ['tab', 'posts'],
      ['tab', 'articles', 'hidden']
    ]);
    expect(autoTabIds(event)).toContain('wikis');
    expect(parseProfileTabsEvent(event).order).toContain('wikis');
  });
});
