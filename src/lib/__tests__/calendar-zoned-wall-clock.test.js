/**
 * zonedWallClock / wallClockToTimestamp — the edit form shows and parses a
 * timed event's date and time in the event's own zone (NIP-52 start_tzid),
 * not the editor's, so a no-op edit keeps the stored timestamps.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  zonedWallClock,
  wallClockToTimestamp,
  convertFormDataToEvent
} from '$lib/helpers/calendar.js';

// Node re-reads process.env.TZ per date operation (see upcoming-date-parts).
const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const s = (/** @type {string} */ iso) => Date.parse(iso) / 1000;

describe('zonedWallClock', () => {
  it('shows a New York 10:00 event as 10:00 to a Berlin editor', () => {
    process.env.TZ = 'Europe/Berlin';
    expect(zonedWallClock(s('2026-11-10T15:00:00Z'), 'America/New_York')).toEqual({
      date: '2026-11-10',
      time: '10:00'
    });
  });

  it("uses the event zone's day, not the editor's", () => {
    process.env.TZ = 'Europe/Berlin';
    // 23:30 in New York is already the next day in Berlin.
    expect(zonedWallClock(s('2026-11-11T04:30:00Z'), 'America/New_York')).toEqual({
      date: '2026-11-10',
      time: '23:30'
    });
  });

  it('falls back to the editor zone for a missing or invalid zone', () => {
    process.env.TZ = 'Europe/Berlin';
    const local = { date: '2026-11-10', time: '16:00' };
    expect(zonedWallClock(s('2026-11-10T15:00:00Z'), undefined)).toEqual(local);
    expect(zonedWallClock(s('2026-11-10T15:00:00Z'), 'Mars/Olympus')).toEqual(local);
  });
});

describe('wallClockToTimestamp', () => {
  it('reads the wall-clock time in the given zone, whatever the editor zone', () => {
    for (const tz of ['Europe/Berlin', 'Asia/Tokyo', 'UTC', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      expect(wallClockToTimestamp('2026-11-10', '10:00', 'America/New_York')).toBe(
        s('2026-11-10T15:00:00Z')
      );
    }
  });

  it('falls back to the editor zone for a missing or invalid zone', () => {
    process.env.TZ = 'Europe/Berlin';
    expect(wallClockToTimestamp('2026-11-10', '16:00', '')).toBe(s('2026-11-10T15:00:00Z'));
    expect(wallClockToTimestamp('2026-11-10', '16:00', 'Nope/Nope')).toBe(
      s('2026-11-10T15:00:00Z')
    );
  });

  it('returns NaN for an incomplete date or time', () => {
    expect(wallClockToTimestamp('', '10:00', 'America/New_York')).toBeNaN();
    expect(wallClockToTimestamp('2026-11-10', '', 'America/New_York')).toBeNaN();
  });

  // US clocks go forward on 2026-03-08, European ones only on 2026-03-29:
  // in between, New York is 5 h behind Berlin instead of 6.
  it('uses the offset of that day across a DST change in the event zone', () => {
    process.env.TZ = 'Europe/Berlin';
    expect(wallClockToTimestamp('2026-03-07', '10:00', 'America/New_York')).toBe(
      s('2026-03-07T15:00:00Z')
    );
    expect(wallClockToTimestamp('2026-03-08', '10:00', 'America/New_York')).toBe(
      s('2026-03-08T14:00:00Z')
    );
    expect(zonedWallClock(s('2026-03-08T14:00:00Z'), 'America/New_York')).toEqual({
      date: '2026-03-08',
      time: '10:00'
    });
  });

  it('moves a time inside the spring-forward gap forward, like a local Date does', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 02:30 does not exist in New York on 2026-03-08; it becomes 03:30 EDT.
    expect(wallClockToTimestamp('2026-03-08', '02:30', 'America/New_York')).toBe(
      s('2026-03-08T07:30:00Z')
    );
  });

  it('takes the first of the two fall-back 01:30s, like a local Date does', () => {
    process.env.TZ = 'Asia/Tokyo';
    // 2026-11-01 01:30 happens twice in New York: EDT (05:30Z), then EST.
    expect(wallClockToTimestamp('2026-11-01', '01:30', 'America/New_York')).toBe(
      s('2026-11-01T05:30:00Z')
    );
  });

  it('round-trips every hour around both New York DST changes', () => {
    process.env.TZ = 'Europe/Berlin';
    for (const from of ['2026-03-08T00:00:00Z', '2026-11-01T00:00:00Z']) {
      for (let h = 0; h < 24; h++) {
        const t = s(from) + h * 3600;
        const { date, time } = zonedWallClock(t, 'America/New_York');
        const back = wallClockToTimestamp(date, time, 'America/New_York');
        // The repeated fall-back hour maps to its first occurrence.
        expect([t, t - 3600]).toContain(back);
        expect(zonedWallClock(back, 'America/New_York')).toEqual({ date, time });
      }
    }
  });
});

describe('convertFormDataToEvent (timed)', () => {
  const form = {
    title: 'Webinar',
    eventType: 'time',
    isAllDay: false,
    startDate: '2026-11-10',
    startTime: '10:00',
    endDate: '2026-11-10',
    endTime: '11:30',
    startTimezone: 'America/New_York',
    endTimezone: 'America/New_York'
  };

  it('stores the form times as wall-clock times in start_tzid / end_tzid', () => {
    process.env.TZ = 'Europe/Berlin';
    const event = convertFormDataToEvent(/** @type {any} */ (form), '');
    expect(event.start).toBe(s('2026-11-10T15:00:00Z'));
    expect(event.end).toBe(s('2026-11-10T16:30:00Z'));
  });

  it('reads the end in end_tzid when it differs from start_tzid', () => {
    process.env.TZ = 'Europe/Berlin';
    const event = convertFormDataToEvent(
      /** @type {any} */ ({ ...form, endTime: '17:30', endTimezone: 'Europe/London' }),
      ''
    );
    expect(event.end).toBe(s('2026-11-10T17:30:00Z'));
  });
});
