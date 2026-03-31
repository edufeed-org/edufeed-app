/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { filterUpcomingEvents, mergeCommunityActivity } from '../helpers/dashboardFilters.js';

/** Helper to create a fake event */
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
