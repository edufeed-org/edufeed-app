// @ts-nocheck
/**
 * Community feed ranking tests (edufeed-app#21 / feed part of #8 report)
 *
 * A freshly shared OLD event must rank by the share time, not the original
 * created_at — otherwise it sinks below the feed's top-N cut and never shows
 * in "Recent Activity". Upcoming events must be selected from the FULL item
 * set, not from the already-truncated feed.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  activityTimestamp,
  mergeFeedItems,
  selectUpcomingEvents
} from '$lib/helpers/community-feed.js';

const NOW = 1_800_000_000;

function item(id, created_at, extra = {}) {
  return { id, kind: 1, created_at, ...extra };
}

describe('activityTimestamp', () => {
  it('uses created_at for direct events', () => {
    expect(activityTimestamp(item('a', 100))).toBe(100);
  });

  it('uses the share time when it is newer than the event', () => {
    expect(activityTimestamp(item('a', 100, { _sharedAt: 500 }))).toBe(500);
  });
});

describe('mergeFeedItems', () => {
  it('ranks a freshly shared old event above stale direct events', () => {
    const oldSharedEvent = item('shared', NOW - 900_000, { _sharedAt: NOW });
    const directItems = Array.from({ length: 20 }, (_, i) => item(`d${i}`, NOW - (i + 1) * 100));

    const { top } = mergeFeedItems([directItems, [oldSharedEvent]], 15);

    expect(top[0].id).toBe('shared');
  });

  it('dedupes by id and returns the full set alongside the capped list', () => {
    const a = item('a', 3);
    const dup = item('a', 3);
    const b = item('b', 2);
    const c = item('c', 1);

    const { top, all } = mergeFeedItems(
      [
        [a, b],
        [dup, c]
      ],
      2
    );

    expect(top.map((e) => e.id)).toEqual(['a', 'b']);
    expect(all.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('selectUpcomingEvents', () => {
  it('picks future calendar events sorted by start, ignoring the feed cap', () => {
    const items = [
      item('past', 10, { kind: 31923, start: NOW - 100 }),
      item('soon', 20, { kind: 31922, start: NOW + 100 }),
      item('later', 30, { kind: 31923, start: NOW + 500 }),
      item('note', 40) // kind 1 — not an event
    ];

    const upcoming = selectUpcomingEvents(items, (e) => e.start, NOW, 5);

    expect(upcoming.map((e) => e.id)).toEqual(['soon', 'later']);
  });

  it('caps the result', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item(`e${i}`, i, { kind: 31923, start: NOW + i + 1 })
    );
    expect(selectUpcomingEvents(items, (e) => e.start, NOW, 5)).toHaveLength(5);
  });
});
