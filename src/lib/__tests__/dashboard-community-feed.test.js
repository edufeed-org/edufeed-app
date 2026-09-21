/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { filterUpcomingEvents, mergeCommunityActivity } from '../helpers/dashboardFilters.js';

/** Helper to create a fake event
 * @param {number} kind
 * @param {number} created_at
 * @param {string[][]} [tags]
 */
function makeEvent(kind, created_at, tags = []) {
  return { id: `id-${kind}-${created_at}`, kind, created_at, pubkey: 'abc', tags, content: '' };
}

describe('filterUpcomingEvents', () => {
  const nowTs = 1000;

  it('returns only future calendar events sorted by start time', () => {
    const items = [
      makeEvent(31922, 900, [['start', '1200']]), // future date-based
      makeEvent(31923, 800, [['start', '1100']]), // future time-based, earlier start
      makeEvent(31922, 700, [['start', '900']]), // past
      makeEvent(30142, 950) // non-calendar
    ];
    const result = filterUpcomingEvents(items, nowTs);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe(31923); // start 1100 < 1200
    expect(result[1].kind).toBe(31922);
  });

  it('limits to 4 events', () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeEvent(31922, i, [['start', `${nowTs + i + 1}`]])
    );
    const result = filterUpcomingEvents(items, nowTs);
    expect(result).toHaveLength(4);
  });

  it('returns empty array for empty input', () => {
    expect(filterUpcomingEvents([], nowTs)).toEqual([]);
  });

  it('returns empty when all calendar events are in the past', () => {
    const items = [
      makeEvent(31922, 500, [['start', '800']]),
      makeEvent(31923, 600, [['start', '900']])
    ];
    expect(filterUpcomingEvents(items, nowTs)).toEqual([]);
  });

  it('returns empty when no calendar events exist', () => {
    const items = [makeEvent(30142, 950), makeEvent(30301, 960)];
    expect(filterUpcomingEvents(items, nowTs)).toEqual([]);
  });
});

describe('mergeCommunityActivity', () => {
  it('merges items from multiple communities sorted by created_at desc', () => {
    const perCommunityItems = new Map([
      ['community-a', [makeEvent(30142, 300), makeEvent(30142, 100)]],
      ['community-b', [makeEvent(30301, 200), makeEvent(30023, 400)]]
    ]);
    const result = mergeCommunityActivity(perCommunityItems);
    expect(result).toHaveLength(4);
    expect(result.map((e) => e.created_at)).toEqual([400, 300, 200, 100]);
  });

  it('deduplicates by event ID (same event in multiple communities)', () => {
    const sharedEvent = makeEvent(30142, 500);
    const perCommunityItems = new Map([
      ['community-a', [sharedEvent, makeEvent(30301, 200)]],
      ['community-b', [sharedEvent, makeEvent(30023, 300)]]
    ]);
    const result = mergeCommunityActivity(perCommunityItems);
    expect(result).toHaveLength(3);
    expect(result.filter((e) => e.id === sharedEvent.id)).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(mergeCommunityActivity(new Map())).toEqual([]);
  });

  it('handles communities with empty item arrays', () => {
    const perCommunityItems = new Map([
      ['community-a', []],
      ['community-b', [makeEvent(30142, 100)]]
    ]);
    const result = mergeCommunityActivity(perCommunityItems);
    expect(result).toHaveLength(1);
  });
});

describe('cross-kind calendar twins on the dashboard', () => {
  // One appointment, two live addresses: the publisher republished a timed
  // 31923 as an all-day 31922 under the same d-tag. Replaceability is per
  // kind:pubkey:d, so the EventStore rightly keeps both and the rail showed
  // the appointment twice — with two different (and one fabricated) times.
  /**
   * @param {string} id
   * @param {number} kind
   * @param {number} created_at
   * @param {string} start
   */
  const twin = (id, kind, created_at, start) => ({
    id,
    kind,
    created_at,
    pubkey: 'abc',
    tags: [
      ['d', 'shared-d'],
      ['start', start]
    ],
    content: ''
  });

  it('filterUpcomingEvents keeps only the newest version', () => {
    const result = filterUpcomingEvents(
      [twin('timed', 31923, 100, '1100'), twin('allday', 31922, 200, '2026-09-17')],
      1000
    );
    expect(result.map((e) => e.id)).toEqual(['allday']);
  });

  it('filterUpcomingEvents still lists distinct appointments', () => {
    const other = {
      ...twin('other', 31923, 50, '1200'),
      tags: [
        ['d', 'other-d'],
        ['start', '1200']
      ]
    };
    const result = filterUpcomingEvents([twin('timed', 31923, 100, '1100'), other], 1000);
    expect(result).toHaveLength(2);
  });

  it('mergeCommunityActivity collapses a twin h-tagged into two communities', () => {
    const merged = mergeCommunityActivity(
      new Map([
        ['community-a', [twin('timed', 31923, 100, '1100')]],
        ['community-b', [twin('allday', 31922, 200, '2026-09-17')]]
      ])
    );
    expect(merged.map((e) => e.id)).toEqual(['allday']);
  });

  it('mergeCommunityActivity leaves non-calendar content untouched', () => {
    const merged = mergeCommunityActivity(
      new Map([
        ['community-a', [makeEvent(1, 100), makeEvent(30023, 200, [['d', 'shared-d']])]],
        ['community-b', [makeEvent(30142, 150, [['d', 'shared-d']])]]
      ])
    );
    expect(merged).toHaveLength(3);
  });
});
