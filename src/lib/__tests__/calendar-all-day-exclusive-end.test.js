// @ts-nocheck
/**
 * NIP-52 all-day events (kind 31922): `start` is inclusive, `end` is
 * EXCLUSIVE and must be greater than `start`; an omitted `end` means the
 * event ends on its start day.
 *
 * The form keeps showing the inclusive last day. Conversion happens only at
 * the tag boundary: the writer omits `end` for a one-day event and writes
 * last day + 1 otherwise; the reader subtracts the day again, so a
 * CalendarEvent's `end` stays the midnight of the last day. Legacy events
 * written by older app versions (`end == start`) read as one-day events.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));

const {
  buildCalendarEventTags,
  convertFormDataToEvent,
  getIcsEventTiming,
  getEventEndTimestamp,
  isRawEventInDateRange
} = await import('$lib/helpers/calendar.js');
const { getCalendarEventMetadata } = await import('$lib/helpers/eventUtils.js');
const { formDateFromTimestamp } = await import('$lib/helpers/calendar-timing.js');

const DAY = 86400;
const JAN_5 = Date.UTC(2026, 0, 5) / 1000;

/** @param {string} startDate @param {string} endDate */
function allDayTags(startDate, endDate) {
  const formData = { title: 'Workshop', eventType: 'date', isAllDay: true, startDate, endDate };
  const eventData = convertFormDataToEvent(formData, '');
  return buildCalendarEventTags(formData, eventData, 'd-tag');
}

const tagValues = (tags, name) => tags.filter((t) => t[0] === name).map((t) => t[1]);

const rawAllDay = (tags) => ({
  id: 'e'.repeat(64),
  kind: 31922,
  pubkey: 'a'.repeat(64),
  created_at: 1,
  content: '',
  tags: [['d', 'x'], ['title', 'T'], ...tags]
});

describe('buildCalendarEventTags — 31922 end is exclusive', () => {
  it('omits end for a one-day event (end date equals start date)', () => {
    const tags = allDayTags('2026-01-05', '2026-01-05');
    expect(tagValues(tags, 'start')).toEqual(['2026-01-05']);
    expect(tagValues(tags, 'end')).toEqual([]);
  });

  it('omits end when the form has no end date', () => {
    expect(tagValues(allDayTags('2026-01-05', ''), 'end')).toEqual([]);
  });

  it('writes the last day plus one for a multi-day event', () => {
    expect(tagValues(allDayTags('2026-01-05', '2026-01-06'), 'end')).toEqual(['2026-01-07']);
  });

  it('rolls the exclusive end over month and year boundaries', () => {
    expect(tagValues(allDayTags('2026-12-30', '2026-12-31'), 'end')).toEqual(['2027-01-01']);
    expect(tagValues(allDayTags('2028-02-27', '2028-02-29'), 'end')).toEqual(['2028-03-01']);
  });

  it('never writes an end that is not after the start', () => {
    // An end before the start is rejected by form validation; the writer
    // still must not emit a NIP-52-invalid end for it.
    expect(tagValues(allDayTags('2026-01-05', '2026-01-04'), 'end')).toEqual([]);
  });
});

describe('getCalendarEventMetadata — 31922 end read as exclusive', () => {
  it('maps an exclusive end back to the midnight of the last day', () => {
    const ev = getCalendarEventMetadata(
      rawAllDay([
        ['start', '2026-01-05'],
        ['end', '2026-01-08']
      ])
    );
    expect(ev.start).toBe(JAN_5);
    expect(ev.end).toBe(JAN_5 + 2 * DAY);
  });

  it('reads a conformant one-day event (end = start + 1) as ending on its start day', () => {
    const ev = getCalendarEventMetadata(
      rawAllDay([
        ['start', '2026-01-05'],
        ['end', '2026-01-06']
      ])
    );
    expect(ev.end).toBe(JAN_5);
  });

  it('reads a legacy event with end == start as a one-day event', () => {
    const ev = getCalendarEventMetadata(
      rawAllDay([
        ['start', '2026-01-05'],
        ['end', '2026-01-05']
      ])
    );
    expect(ev.end).toBe(JAN_5);
  });

  it('keeps an omitted end as no end', () => {
    expect(getCalendarEventMetadata(rawAllDay([['start', '2026-01-05']])).end).toBe(0);
  });
});

describe('edit round-trip — the form shows the inclusive last day', () => {
  /** @param {string} startDate @param {string} endDate */
  function roundTrip(startDate, endDate) {
    const tags = allDayTags(startDate, endDate);
    const ev = getCalendarEventMetadata(rawAllDay(tags.filter((t) => t[0] !== 'd')));
    return {
      start: formDateFromTimestamp(ev.start, 31922),
      end: ev.end ? formDateFromTimestamp(ev.end, 31922) : ''
    };
  }

  it('multi-day: the form gets the same last day back', () => {
    expect(roundTrip('2026-01-05', '2026-01-07')).toEqual({
      start: '2026-01-05',
      end: '2026-01-07'
    });
  });

  it('one-day: the event comes back without an end and re-saves without one', () => {
    const back = roundTrip('2026-01-05', '2026-01-05');
    expect(back).toEqual({ start: '2026-01-05', end: '' });
    expect(tagValues(allDayTags(back.start, back.end), 'end')).toEqual([]);
  });
});

describe('getIcsEventTiming — DTEND is the exclusive NIP-52 end', () => {
  it('uses a 31922 exclusive end as DTEND unchanged', () => {
    const t = getIcsEventTiming(
      rawAllDay([
        ['start', '2026-01-05'],
        ['end', '2026-01-08']
      ])
    );
    expect(t).toEqual({ isAllDay: true, start: JAN_5, end: JAN_5 + 3 * DAY });
  });

  it('exports a legacy end == start as a one-day event', () => {
    const t = getIcsEventTiming(
      rawAllDay([
        ['start', '2026-01-05'],
        ['end', '2026-01-05']
      ])
    );
    expect(t).toEqual({ isAllDay: true, start: JAN_5, end: JAN_5 + DAY });
  });
});

describe('raw range helpers — 31922 end read as exclusive', () => {
  const oneDay = rawAllDay([
    ['start', '2026-01-05'],
    ['end', '2026-01-06']
  ]);

  it('getEventEndTimestamp returns the last day, not the exclusive end', () => {
    expect(getEventEndTimestamp(oneDay)).toBe(JAN_5);
  });

  it('a one-day event does not overlap a range that starts the next day', () => {
    expect(isRawEventInDateRange(oneDay, JAN_5 + DAY, JAN_5 + 8 * DAY)).toBe(false);
    expect(isRawEventInDateRange(oneDay, JAN_5 - 7 * DAY, JAN_5)).toBe(false);
    expect(isRawEventInDateRange(oneDay, JAN_5 - 7 * DAY, JAN_5 + 1)).toBe(true);
  });
});
