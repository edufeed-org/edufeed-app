/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { filterUpcomingEvents, filterRecentActivity } from '../helpers/dashboardFilters.js';

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

describe('filterRecentActivity', () => {
  it('returns all kinds sorted by created_at desc, limited to 8', () => {
    const items = Array.from({ length: 12 }, (_, i) => makeEvent(30142, i * 100));
    const result = filterRecentActivity(items);
    expect(result).toHaveLength(8);
    expect(result[0].created_at).toBe(1100); // highest
    expect(result[7].created_at).toBe(400); // 8th highest
  });

  it('returns empty array for empty input', () => {
    expect(filterRecentActivity([])).toEqual([]);
  });

  it('returns all items when fewer than 8', () => {
    const items = [makeEvent(30142, 100), makeEvent(31922, 200)];
    const result = filterRecentActivity(items);
    expect(result).toHaveLength(2);
    expect(result[0].created_at).toBe(200);
  });
});
