// @ts-nocheck
/**
 * NIP-52: `start_tzid` is the zone of the start timestamp, and an omitted
 * `end_tzid` means the end is in the same zone. The detail views printed the
 * viewer's local time next to the event's zone label ("16:00
 * (America/New_York)" for a 10:00 New York event seen from Berlin), and the
 * end of an event with only `start_tzid` had no zone at all.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { calendar: { timeFormat: '24h', weekStartDay: 1 } }
}));

const { formatZonedDateTime, formatCalendarDate } = await import('$lib/helpers/calendar.js');
const { getCalendarEventMetadata } = await import('$lib/helpers/eventUtils.js');

// 2026-05-04 14:00 UTC = 10:00 in New York (EDT) = 16:00 in Berlin (CEST)
const TEN_NY = new Date(Date.UTC(2026, 4, 4, 14, 0));
// 2026-05-04 23:30 New York = 2026-05-05 05:30 Berlin (next day)
const LATE_NY = new Date(Date.UTC(2026, 4, 5, 3, 30));

describe('formatZonedDateTime', () => {
  it("formats in the event's zone and adds the viewer's time when it differs", () => {
    const r = formatZonedDateTime(TEN_NY, 'America/New_York', { viewerTimeZone: 'Europe/Berlin' });
    expect(r.time).toBe('10:00');
    expect(r.zone).toBe('America/New_York');
    expect(r.date).toBe(formatCalendarDate(TEN_NY, 'long', { timeZone: 'America/New_York' }));
    expect(r.local).toEqual({
      date: null,
      time: '16:00',
      zone: 'Europe/Berlin',
      label: '16:00 Europe/Berlin'
    });
  });

  it("names the viewer's day when the local time falls on another date", () => {
    const r = formatZonedDateTime(LATE_NY, 'America/New_York', { viewerTimeZone: 'Europe/Berlin' });
    expect(r.time).toBe('23:30');
    expect(r.date).toContain('4.');
    expect(r.local.time).toBe('5:30');
    expect(r.local.date).toBe(formatCalendarDate(LATE_NY, 'short', { timeZone: 'Europe/Berlin' }));
    expect(r.local.date).toContain('5.');
  });

  it('adds no local time when the viewer is in the same zone', () => {
    const r = formatZonedDateTime(TEN_NY, 'Europe/Berlin', { viewerTimeZone: 'Europe/Berlin' });
    expect(r.time).toBe('16:00');
    expect(r.zone).toBe('Europe/Berlin');
    expect(r.local).toBeNull();
  });

  it('adds no local time when another zone shows the same wall-clock time', () => {
    const r = formatZonedDateTime(TEN_NY, 'Europe/Paris', { viewerTimeZone: 'Europe/Berlin' });
    expect(r.time).toBe('16:00');
    expect(r.local).toBeNull();
  });

  it("falls back to the viewer's time, unlabelled, without a zone", () => {
    const r = formatZonedDateTime(TEN_NY, undefined, { viewerTimeZone: 'Europe/Berlin' });
    expect(r.time).toBe('16:00');
    expect(r.zone).toBe('');
    expect(r.local).toBeNull();
  });

  it("falls back to the viewer's time, unlabelled, for an invalid zone", () => {
    const r = formatZonedDateTime(TEN_NY, 'Mars/Olympus_Mons', {
      viewerTimeZone: 'Europe/Berlin'
    });
    expect(r.time).toBe('16:00');
    expect(r.zone).toBe('');
    expect(r.local).toBeNull();
  });
});

describe('getCalendarEventMetadata — end_tzid', () => {
  const base = (extra) => ({
    id: 'e'.repeat(64),
    kind: 31923,
    pubkey: 'a'.repeat(64),
    created_at: 1,
    content: '',
    tags: [['d', 'x'], ['title', 'T'], ['start', '1777903200'], ...extra]
  });

  it('inherits end_tzid from start_tzid when omitted', () => {
    const ev = getCalendarEventMetadata(base([['start_tzid', 'America/New_York']]));
    expect(ev.startTimezone).toBe('America/New_York');
    expect(ev.endTimezone).toBe('America/New_York');
  });

  it('keeps an explicit end_tzid', () => {
    const ev = getCalendarEventMetadata(
      base([
        ['start_tzid', 'America/New_York'],
        ['end_tzid', 'Europe/Berlin']
      ])
    );
    expect(ev.endTimezone).toBe('Europe/Berlin');
  });

  it('has no end zone without either tag', () => {
    const ev = getCalendarEventMetadata(base([]));
    expect(ev.endTimezone).toBeFalsy();
  });
});
