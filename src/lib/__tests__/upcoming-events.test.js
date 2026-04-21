/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEventStartTimestamp } from '$lib/helpers/calendar.js';

/**
 * Extracts upcoming calendar events from a feed — mirrors the $derived logic in HomeView.
 * @param {import('nostr-tools').NostrEvent[]} feedItems
 * @returns {import('nostr-tools').NostrEvent[]}
 */
function getUpcomingEvents(feedItems) {
  const now = Math.floor(Date.now() / 1000);
  return feedItems
    .filter((e) => (e.kind === 31922 || e.kind === 31923) && getEventStartTimestamp(e) > now)
    .sort((a, b) => getEventStartTimestamp(a) - getEventStartTimestamp(b))
    .slice(0, 5);
}

/** @param {Partial<import('nostr-tools').NostrEvent>} overrides */
function makeEvent(overrides) {
  return {
    id: Math.random().toString(36).slice(2),
    pubkey: 'abc',
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    sig: '',
    tags: [],
    kind: 1,
    ...overrides
  };
}

const NOW = 1700000000;

describe('getUpcomingEvents (HomeView derived logic)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters only calendar events with future start times', () => {
    const items = [
      makeEvent({ kind: 1, tags: [] }),
      makeEvent({ kind: 30142, tags: [] }),
      makeEvent({
        kind: 31922,
        tags: [
          ['d', 'ev1'],
          ['start', '2023-11-15']
        ]
      }), // future date-based
      makeEvent({
        kind: 31923,
        tags: [
          ['d', 'ev2'],
          ['start', String(NOW + 3600)]
        ]
      }), // future time-based
      makeEvent({
        kind: 31923,
        tags: [
          ['d', 'ev3'],
          ['start', String(NOW - 3600)]
        ]
      }) // past time-based
    ];

    const result = getUpcomingEvents(items);

    // Only the two future calendar events
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.kind === 31922 || e.kind === 31923)).toBe(true);
  });

  it('sorts by start time ascending (soonest first)', () => {
    const items = [
      makeEvent({
        kind: 31923,
        tags: [
          ['d', 'later'],
          ['start', String(NOW + 7200)]
        ]
      }),
      makeEvent({
        kind: 31923,
        tags: [
          ['d', 'sooner'],
          ['start', String(NOW + 1800)]
        ]
      }),
      makeEvent({
        kind: 31923,
        tags: [
          ['d', 'mid'],
          ['start', String(NOW + 3600)]
        ]
      })
    ];

    const result = getUpcomingEvents(items);

    expect(result).toHaveLength(3);
    expect(/** @type {any} */ (result[0].tags.find((t) => t[0] === 'd'))[1]).toBe('sooner');
    expect(/** @type {any} */ (result[1].tags.find((t) => t[0] === 'd'))[1]).toBe('mid');
    expect(/** @type {any} */ (result[2].tags.find((t) => t[0] === 'd'))[1]).toBe('later');
  });

  it('limits to 5 events', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      makeEvent({
        kind: 31923,
        tags: [
          ['d', `ev${i}`],
          ['start', String(NOW + (i + 1) * 3600)]
        ]
      })
    );

    const result = getUpcomingEvents(items);
    expect(result).toHaveLength(5);
  });

  it('excludes past events', () => {
    const items = [
      makeEvent({
        kind: 31923,
        tags: [
          ['d', 'past'],
          ['start', String(NOW - 100)]
        ]
      }),
      makeEvent({
        kind: 31922,
        tags: [
          ['d', 'past2'],
          ['start', '2020-01-01']
        ]
      })
    ];

    const result = getUpcomingEvents(items);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no calendar events exist', () => {
    const items = [makeEvent({ kind: 1 }), makeEvent({ kind: 30142 }), makeEvent({ kind: 9 })];

    const result = getUpcomingEvents(items);
    expect(result).toHaveLength(0);
  });
});
