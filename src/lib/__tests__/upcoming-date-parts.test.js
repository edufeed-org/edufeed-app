// @ts-nocheck
/**
 * Compact "upcoming events" rail formatting (issue "Better support for
 * calendar appointments", reopened).
 *
 * The community home rail rendered every event with `{ hour, minute }`, so a
 * kind 31922 all-day event whose `start` tag is a plain "YYYY-MM-DD" showed a
 * fabricated clock time. `parseCalendarTimestamp` resolves that date to
 * MIDNIGHT UTC, so rendering it in the viewer's zone also moves it: CEST
 * turned 2026-09-17 into "17. Sept., 02:00", and any zone west of UTC would
 * show the previous day.
 *
 * Rules: 31922 → never a time, always rendered in UTC. 31923 → real local time.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));

const { getUpcomingDateParts } = await import('$lib/helpers/dates.js');

const TIME_PATTERN = /\d{1,2}[:.]\d{2}\b/;

// Node re-reads process.env.TZ per date operation, so a test can stand in any
// zone — but it must hand the zone back or it leaks into the whole worker.
const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

// 2026-09-17, the all-day start from the reopened report.
const SEP_17_UTC = Date.UTC(2026, 8, 17) / 1000;
// 2026-09-21T13:00:00Z — a genuinely timed event.
const SEP_21_13H_UTC = Date.UTC(2026, 8, 21, 13, 0) / 1000;

describe('getUpcomingDateParts — kind 31922 (all-day)', () => {
  it('shows no time at all', () => {
    const parts = getUpcomingDateParts(SEP_17_UTC, 31922);
    expect(parts.time).toBe('');
    expect(parts.label).not.toMatch(TIME_PATTERN);
  });

  it('keeps the calendar day the publisher wrote, east of UTC', () => {
    process.env.TZ = 'Europe/Berlin';
    const parts = getUpcomingDateParts(SEP_17_UTC, 31922);
    expect(parts.day).toBe('17');
    expect(parts.label).not.toMatch(TIME_PATTERN);
  });

  it('keeps the calendar day the publisher wrote, west of UTC', () => {
    process.env.TZ = 'America/New_York';
    const parts = getUpcomingDateParts(SEP_17_UTC, 31922);
    expect(parts.day).toBe('17');
  });

  it('labels with the date alone', () => {
    expect(getUpcomingDateParts(SEP_17_UTC, 31922).label).toBe(
      getUpcomingDateParts(SEP_17_UTC, 31922).date
    );
  });
});

describe('getUpcomingDateParts — kind 31923 (time-based)', () => {
  it('shows a zero-padded local time', () => {
    const parts = getUpcomingDateParts(SEP_21_13H_UTC, 31923);
    expect(parts.time).toMatch(TIME_PATTERN);
  });

  it('joins date and time in the label', () => {
    const parts = getUpcomingDateParts(SEP_21_13H_UTC, 31923);
    expect(parts.label).toBe(`${parts.date}, ${parts.time}`);
  });

  it('exposes day and month for the date square', () => {
    const parts = getUpcomingDateParts(SEP_21_13H_UTC, 31923);
    expect(parts.day).toMatch(/^\d{1,2}$/);
    expect(parts.month).toBeTruthy();
  });
});
