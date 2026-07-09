// @ts-nocheck
/**
 * groupEventsByDate multi-day span tests (edufeed-app#11)
 *
 * A calendar event running over several days must appear on every day it
 * covers, not just its start day.
 *
 * End-bound conventions:
 * - kind 31922 (date-based): the app's own writer stores the user's chosen
 *   end date as-is (inclusive), so the end day is included.
 * - kind 31923 (time-based): NIP-52 end timestamps are exclusive, so an
 *   event ending exactly at midnight does not bleed into the next day.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { groupEventsByDate } from '$lib/helpers/calendar.js';

const DAY = 86400;
// 2026-10-01T00:00:00Z
const OCT_1 = Date.UTC(2026, 9, 1) / 1000;

function daysWithEvent(grouped, id) {
  return [...grouped.entries()]
    .filter(([, evts]) => evts.some((e) => e.id === id))
    .map(([key]) => key)
    .sort();
}

describe('groupEventsByDate multi-day spans', () => {
  it('keeps single-day events on exactly one day', () => {
    const grouped = groupEventsByDate([{ id: 'a', kind: 31922, start: OCT_1, title: 'one-day' }]);
    expect(daysWithEvent(grouped, 'a')).toEqual(['2026-10-01']);
  });

  it('shows a date-based event (31922) on its end day too', () => {
    const grouped = groupEventsByDate([
      { id: 'b', kind: 31922, start: OCT_1, end: OCT_1 + DAY, title: 'Oct 1-2' }
    ]);
    expect(daysWithEvent(grouped, 'b')).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('shows a three-day date-based event on all three days', () => {
    const grouped = groupEventsByDate([
      { id: 'c', kind: 31922, start: OCT_1, end: OCT_1 + 2 * DAY, title: 'Oct 1-3' }
    ]);
    expect(daysWithEvent(grouped, 'c')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('shows a time-based event (31923) crossing midnight on both days', () => {
    const grouped = groupEventsByDate([
      {
        id: 'd',
        kind: 31923,
        start: OCT_1 + 22 * 3600, // Oct 1, 22:00 UTC
        end: OCT_1 + DAY + 2 * 3600, // Oct 2, 02:00 UTC
        title: 'late party'
      }
    ]);
    expect(daysWithEvent(grouped, 'd')).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('does not bleed a time-based event ending exactly at midnight into the next day', () => {
    const grouped = groupEventsByDate([
      {
        id: 'e',
        kind: 31923,
        start: OCT_1 + 20 * 3600,
        end: OCT_1 + DAY, // exclusive end: Oct 2, 00:00 UTC
        title: 'evening'
      }
    ]);
    expect(daysWithEvent(grouped, 'e')).toEqual(['2026-10-01']);
  });

  it('caps absurd spans instead of flooding the calendar', () => {
    const grouped = groupEventsByDate([
      { id: 'f', kind: 31923, start: OCT_1, end: OCT_1 + 10 * 365 * DAY, title: 'bogus' }
    ]);
    const days = daysWithEvent(grouped, 'f');
    expect(days.length).toBeGreaterThan(1);
    expect(days.length).toBeLessThanOrEqual(93);
  });

  it('ignores an end before the start', () => {
    const grouped = groupEventsByDate([
      { id: 'g', kind: 31923, start: OCT_1, end: OCT_1 - DAY, title: 'inverted' }
    ]);
    expect(daysWithEvent(grouped, 'g')).toEqual(['2026-10-01']);
  });
});
