// @ts-nocheck
/**
 * Week-lane layout tests for spanning multi-day event bars (edufeed-app#20)
 *
 * Multi-day events render as continuous bars across the days of a week row.
 * Overlapping bars stack into lanes; a bar keeps its lane for its whole
 * visible span, and days where a higher lane is occupied but a lower one is
 * free get an explicit empty slot so bars stay vertically aligned.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getEventDaySpan } from '$lib/helpers/calendar.js';
import { isMultiDayEvent, layoutWeekLanes } from '$lib/helpers/calendar-lanes.js';

const DAY = 86400;
const OCT_1 = Date.UTC(2026, 9, 1) / 1000; // Thursday
const OCT_5 = OCT_1 + 4 * DAY; // Monday

// Week of Mon Oct 5 – Sun Oct 11 as UTC date keys
const WEEK = Array.from({ length: 7 }, (_, i) =>
  new Date((OCT_5 + i * DAY) * 1000).toISOString().slice(0, 10)
);

function evt(id, kind, start, end) {
  return { id, kind, start, end, title: id };
}

describe('getEventDaySpan', () => {
  it('spans inclusive end days for date-based events (31922)', () => {
    const span = getEventDaySpan(evt('a', 31922, OCT_1, OCT_1 + DAY));
    expect(span.endDay - span.startDay).toBe(1);
  });

  it('treats time-based (31923) midnight ends as exclusive', () => {
    const span = getEventDaySpan(evt('a', 31923, OCT_1 + 20 * 3600, OCT_1 + DAY));
    expect(span.endDay).toBe(span.startDay);
  });
});

describe('isMultiDayEvent', () => {
  it('is false for single-day and true for spanning events', () => {
    expect(isMultiDayEvent(evt('a', 31923, OCT_1, OCT_1 + 3600))).toBe(false);
    expect(isMultiDayEvent(evt('b', 31922, OCT_1, OCT_1 + 2 * DAY))).toBe(true);
  });
});

describe('layoutWeekLanes', () => {
  it('lays a Tue-Thu event into one lane with correct caps and title day', () => {
    const e = evt('a', 31922, OCT_5 + DAY, OCT_5 + 3 * DAY); // Tue-Thu inclusive
    const { laneCount, cells } = layoutWeekLanes(WEEK, [e]);

    expect(laneCount).toBe(1);
    expect(cells.get(WEEK[0])).toEqual([null]); // Monday: spacer only
    const tue = cells.get(WEEK[1])[0];
    expect(tue).toMatchObject({ continuesLeft: false, showTitle: true });
    const wed = cells.get(WEEK[2])[0];
    expect(wed).toMatchObject({ continuesLeft: true, continuesRight: true, showTitle: false });
    const thu = cells.get(WEEK[3])[0];
    expect(thu).toMatchObject({ continuesRight: false });
    expect(cells.get(WEEK[4])[0]).toBe(null); // Friday: nothing
  });

  it('marks continuation arrows when the span crosses the week boundaries', () => {
    const e = evt('long', 31922, OCT_1, OCT_5 + 10 * DAY); // starts before, ends after this week
    const { cells } = layoutWeekLanes(WEEK, [e]);

    expect(cells.get(WEEK[0])[0]).toMatchObject({
      continuesLeft: true,
      clippedLeft: true,
      showTitle: true
    });
    expect(cells.get(WEEK[6])[0]).toMatchObject({ continuesRight: true, clippedRight: true });
    expect(cells.get(WEEK[3])[0]).toMatchObject({ clippedLeft: false, clippedRight: false });
  });

  it('stacks overlapping events into stable lanes with spacers below', () => {
    const a = evt('a', 31922, OCT_5, OCT_5 + 2 * DAY); // Mon-Wed
    const b = evt('b', 31922, OCT_5 + DAY, OCT_5 + 4 * DAY); // Tue-Fri
    const { laneCount, cells } = layoutWeekLanes(WEEK, [a, b]);

    expect(laneCount).toBe(2);
    // Monday: a in lane 0, spacer in lane 1? No — lane 1 unused Monday, but
    // slots length equals laneCount for alignment.
    expect(cells.get(WEEK[0])[0].event.id).toBe('a');
    expect(cells.get(WEEK[1])[0].event.id).toBe('a');
    expect(cells.get(WEEK[1])[1].event.id).toBe('b');
    // Thursday: a is over → lane 0 empty spacer, b stays in lane 1
    expect(cells.get(WEEK[3])[0]).toBe(null);
    expect(cells.get(WEEK[3])[1].event.id).toBe('b');
  });

  it('reuses a freed lane for a later non-overlapping event', () => {
    const a = evt('a', 31922, OCT_5, OCT_5 + DAY); // Mon-Tue
    const b = evt('b', 31922, OCT_5 + 3 * DAY, OCT_5 + 4 * DAY); // Thu-Fri
    const { laneCount, cells } = layoutWeekLanes(WEEK, [a, b]);

    expect(laneCount).toBe(1);
    expect(cells.get(WEEK[3])[0].event.id).toBe('b');
  });

  it('ignores events that do not overlap the week', () => {
    const e = evt('elsewhere', 31922, OCT_5 + 30 * DAY, OCT_5 + 32 * DAY);
    const { laneCount } = layoutWeekLanes(WEEK, [e]);
    expect(laneCount).toBe(0);
  });
});
