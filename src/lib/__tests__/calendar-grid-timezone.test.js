// @ts-nocheck
/**
 * Calendar grid timezone consistency (follow-up to edufeed-app's
 * "Calendar edit form: show and edit times in the event's start_tzid" issue
 * — that issue's edit-form part is fixed elsewhere; its note "and,
 * separately, the calendar grid" is this file).
 *
 * The grid (month/week/day/list views) is expected to place and label
 * events in the VIEWER's local zone — that's conventional, not a bug. What
 * must hold regardless of the viewer's zone:
 *  - timed (31923) events land on the viewer's local calendar day
 *  - all-day (31922) events land on their UTC calendar date, never shifted
 *    by the viewer's zone
 *  - multi-day timed events span the correct LOCAL days, even when the
 *    span sits entirely within a single UTC day (or vice versa)
 *  - the week/month view window includes a local-day event even when its
 *    instant falls on an adjacent UTC day
 *
 * Forces TZ to America/New_York (UTC-5 in November) and Asia/Tokyo (UTC+9)
 * — opposite sides of UTC — to catch a fix that only works in one direction.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  getEventDaySpan,
  groupEventsByDate,
  filterEventsByViewMode
} from '$lib/helpers/calendar.js';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

function daysWithEvent(grouped, id) {
  return [...grouped.entries()]
    .filter(([, evts]) => evts.some((e) => e.id === id))
    .map(([key]) => key)
    .sort();
}

describe('timed (31923) events bucket on the viewer local day', () => {
  it('New York (west of UTC): a morning-local event does not fall back a UTC day', () => {
    process.env.TZ = 'America/New_York';
    // 2026-11-10 09:00 America/New_York local == 2026-11-10 14:00 UTC
    const start = Date.UTC(2026, 10, 10, 14, 0) / 1000;
    const event = { id: 'ny-morning', kind: 31923, start, title: 'standup' };

    expect(getEventDaySpan(event).startDay).toBe(getEventDaySpan(event).endDay);
    const grouped = groupEventsByDate([event]);
    expect(daysWithEvent(grouped, 'ny-morning')).toEqual(['2026-11-10']);
  });

  it('New York (west of UTC): a late-evening-local event does not fall back a UTC day', () => {
    process.env.TZ = 'America/New_York';
    // 2026-11-10 18:00 America/New_York local == 2026-11-10 23:00 UTC —
    // same UTC day as the morning case, but the old UTC-floor bucketing
    // put every negative-offset event on d_utc - 1 regardless of time.
    const start = Date.UTC(2026, 10, 10, 23, 0) / 1000;
    const event = { id: 'ny-evening', kind: 31923, start, title: 'dinner' };

    const grouped = groupEventsByDate([event]);
    expect(daysWithEvent(grouped, 'ny-evening')).toEqual(['2026-11-10']);
  });

  it('Tokyo (east of UTC): an event past UTC midnight lands on the viewer next day', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 2026-11-10 23:00 UTC == 2026-11-11 08:00 Asia/Tokyo local
    const start = Date.UTC(2026, 10, 10, 23, 0) / 1000;
    const event = { id: 'tokyo-morning', kind: 31923, start, title: 'morning meeting' };

    const grouped = groupEventsByDate([event]);
    expect(daysWithEvent(grouped, 'tokyo-morning')).toEqual(['2026-11-11']);
  });
});

describe('all-day (31922) events keep their UTC calendar date', () => {
  const start = Date.UTC(2026, 10, 10, 0, 0) / 1000; // midnight UTC, 2026-11-10

  it('is not shifted back a day west of UTC (New York)', () => {
    process.env.TZ = 'America/New_York';
    const grouped = groupEventsByDate([{ id: 'ad-ny', kind: 31922, start, title: 'holiday' }]);
    expect(daysWithEvent(grouped, 'ad-ny')).toEqual(['2026-11-10']);
  });

  it('is not shifted forward a day east of UTC (Tokyo)', () => {
    process.env.TZ = 'Asia/Tokyo';
    const grouped = groupEventsByDate([{ id: 'ad-tokyo', kind: 31922, start, title: 'holiday' }]);
    expect(daysWithEvent(grouped, 'ad-tokyo')).toEqual(['2026-11-10']);
  });

  it('is not shifted in UTC itself (baseline)', () => {
    process.env.TZ = 'UTC';
    const grouped = groupEventsByDate([{ id: 'ad-utc', kind: 31922, start, title: 'holiday' }]);
    expect(daysWithEvent(grouped, 'ad-utc')).toEqual(['2026-11-10']);
  });
});

describe('multi-day timed (31923) events span the correct LOCAL days', () => {
  it('a span entirely inside one UTC day still spans two local days (New York)', () => {
    process.env.TZ = 'America/New_York';
    // 2026-11-10 22:00 local -> 2026-11-11 03:00 UTC
    // 2026-11-11 01:00 local -> 2026-11-11 06:00 UTC
    // Both instants fall on the SAME UTC day (Nov 11): the old UTC-day-index
    // span would have reported a single day. Locally this is an overnight
    // event spanning Nov 10 -> Nov 11.
    const start = Date.UTC(2026, 10, 11, 3, 0) / 1000;
    const end = Date.UTC(2026, 10, 11, 6, 0) / 1000;
    const event = { id: 'overnight', kind: 31923, start, end, title: 'late show' };

    const { startDay, endDay } = getEventDaySpan(event);
    expect(endDay).toBe(startDay + 1);

    const grouped = groupEventsByDate([event]);
    expect(daysWithEvent(grouped, 'overnight')).toEqual(['2026-11-10', '2026-11-11']);
  });

  it('a span crossing two UTC days can still be a single local day (Tokyo)', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 2026-11-10 23:30 UTC -> 2026-11-11 09:30 Asia/Tokyo local (Wed)
    // 2026-11-11 00:30 UTC -> 2026-11-11 09:30 Asia/Tokyo local, same day
    const start = Date.UTC(2026, 10, 10, 23, 30) / 1000;
    const end = Date.UTC(2026, 10, 11, 0, 30) / 1000;
    const event = { id: 'same-local-day', kind: 31923, start, end, title: 'short talk' };

    const { startDay, endDay } = getEventDaySpan(event);
    expect(endDay).toBe(startDay);

    const grouped = groupEventsByDate([event]);
    expect(daysWithEvent(grouped, 'same-local-day')).toEqual(['2026-11-11']);
  });
});

describe('filterEventsByViewMode week/month window follows local days', () => {
  it('day view: a late-local event on the viewed day is not pushed to the next UTC day', () => {
    process.env.TZ = 'America/New_York';
    // 2026-11-10 22:00 America/New_York local == 2026-11-11 03:00 UTC
    const start = Date.UTC(2026, 10, 11, 3, 0) / 1000;
    const event = { id: 'late-local', kind: 31923, start, title: 'late call' };

    const forNov10 = filterEventsByViewMode([event], 'day', new Date(2026, 10, 10));
    expect(forNov10.map((e) => e.id)).toEqual(['late-local']);

    const forNov11 = filterEventsByViewMode([event], 'day', new Date(2026, 10, 11));
    expect(forNov11.map((e) => e.id)).toEqual([]);
  });

  it('week view: a local-evening event is not dropped for crossing into the next UTC day', () => {
    process.env.TZ = 'America/New_York';
    // Week of Mon 2026-11-09 - Sun 2026-11-15 (weekStartDay defaults to
    // Monday). The event sits on the LAST local day of that week, in the
    // evening, so its instant is on the following UTC calendar day — the
    // old pretend-UTC window for that week ended at "Nov 15 23:59:59 UTC",
    // which this instant falls after, incorrectly excluding it.
    const start = Date.UTC(2026, 10, 16, 3, 0) / 1000; // Nov 15 22:00 local
    const event = { id: 'week-edge', kind: 31923, start, title: 'closing call' };

    const currentDate = new Date(2026, 10, 12); // any day in that week
    const filtered = filterEventsByViewMode([event], 'week', currentDate);
    expect(filtered.map((e) => e.id)).toEqual(['week-edge']);
  });

  it('month view: an all-day event keeps its UTC date at the edge of the grid', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 2026-11-01 is a Sunday; with Monday as weekStartDay the grid's first
    // visible cell is Mon 2026-10-26. An all-day event dated exactly there
    // (UTC midnight) must still be included for the November view.
    const start = Date.UTC(2026, 9, 26, 0, 0) / 1000;
    const event = { id: 'grid-edge-allday', kind: 31922, start, title: 'padding day' };

    const filtered = filterEventsByViewMode([event], 'month', new Date(2026, 10, 15));
    expect(filtered.map((e) => e.id)).toEqual(['grid-edge-allday']);
  });
});
