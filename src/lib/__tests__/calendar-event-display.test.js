// @ts-nocheck
/**
 * Kind-aware calendar display helpers (issue "Better support for calendar
 * appointments").
 *
 * NIP-52 rules under test:
 * - kind 31922 (date-based / all-day): start/end are ISO "YYYY-MM-DD" dates.
 *   NO time may ever be displayed — not even 00:00. The app's own writer
 *   stores the end date inclusively.
 * - kind 31923 (time-based): start/end are unix timestamp strings; times are
 *   displayed.
 * - A missing `end` tag means the event has an open end and ends on the same
 *   day as `start`.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => 'de' }));

const {
  isAllDayEvent,
  getEffectiveEventEnd,
  parseCalendarStartParts,
  formatCalendarSubtitle,
  formatEventDateTime,
  getIcsEventTiming,
  dedupeReplaceableEvents
} = await import('$lib/helpers/calendar.js');

const DAY = 86400;
// 2026-01-05T00:00:00Z
const JAN_5 = Date.UTC(2026, 0, 5) / 1000;
// 2026-01-05T15:00:00Z
const JAN_5_15H = JAN_5 + 15 * 3600;

const TIME_PATTERN = /\d{1,2}[:.]\d{2}\b/;

describe('isAllDayEvent', () => {
  it('is true for kind 31922 and false for 31923', () => {
    expect(isAllDayEvent({ kind: 31922 })).toBe(true);
    expect(isAllDayEvent({ kind: 31923 })).toBe(false);
    expect(isAllDayEvent(undefined)).toBe(false);
  });
});

describe('getEffectiveEventEnd — missing end means open end, same day', () => {
  it('31922 without end ends at the end of the start day', () => {
    expect(getEffectiveEventEnd({ kind: 31922, start: JAN_5, end: 0 })).toBe(JAN_5 + DAY);
  });

  it('31922 with an (inclusive) end date ends at the end of that day', () => {
    const end = JAN_5 + 2 * DAY; // 2026-01-07, inclusive
    expect(getEffectiveEventEnd({ kind: 31922, start: JAN_5, end })).toBe(JAN_5 + 3 * DAY);
  });

  it('31923 with an end timestamp ends exactly then', () => {
    expect(getEffectiveEventEnd({ kind: 31923, start: JAN_5_15H, end: JAN_5_15H + 3600 })).toBe(
      JAN_5_15H + 3600
    );
  });

  it('31923 without end ends at the end of the start day (open end)', () => {
    expect(getEffectiveEventEnd({ kind: 31923, start: JAN_5_15H, end: 0 })).toBe(JAN_5 + DAY);
  });

  it('ignores an end before the start', () => {
    expect(getEffectiveEventEnd({ kind: 31923, start: JAN_5_15H, end: JAN_5 })).toBe(JAN_5 + DAY);
  });
});

describe('parseCalendarStartParts — feed card date row', () => {
  it('never shows a time for kind 31922 (ISO start)', () => {
    const parts = parseCalendarStartParts('2026-01-05', 31922);
    expect(parts).not.toBeNull();
    expect(parts.day).toBe('5');
    expect(parts.when).not.toMatch(TIME_PATTERN);
  });

  it('never shows a time for kind 31922 even with a malformed numeric start', () => {
    const parts = parseCalendarStartParts(String(JAN_5_15H), 31922);
    expect(parts).not.toBeNull();
    expect(parts.when).not.toMatch(TIME_PATTERN);
  });

  it('shows a time for kind 31923', () => {
    const parts = parseCalendarStartParts(String(JAN_5_15H), 31923);
    expect(parts).not.toBeNull();
    expect(parts.when).toMatch(TIME_PATTERN);
  });

  it('falls back to the value shape when kind is unknown (legacy callers)', () => {
    expect(parseCalendarStartParts('2026-01-05', undefined).when).not.toMatch(TIME_PATTERN);
    expect(parseCalendarStartParts(String(JAN_5_15H), undefined).when).toMatch(TIME_PATTERN);
  });

  it('uses the UTC day for ISO dates (no off-by-one west of UTC)', () => {
    const parts = parseCalendarStartParts('2026-01-05', 31922);
    expect(parts.day).toBe('5');
  });

  it('returns null for unparseable input', () => {
    expect(parseCalendarStartParts('garbage', 31922)).toBeNull();
    expect(parseCalendarStartParts('', 31923)).toBeNull();
  });
});

describe('formatCalendarSubtitle — pinned section', () => {
  it('formats a 31922 start as DD.MM.YYYY with no time', () => {
    expect(formatCalendarSubtitle('2026-01-05', 31922)).toBe('05.01.2026');
  });

  it('includes a time for 31923', () => {
    const s = formatCalendarSubtitle(String(JAN_5_15H), 31923);
    expect(s).toMatch(TIME_PATTERN);
  });

  it('returns the raw value when unparseable', () => {
    expect(formatCalendarSubtitle('garbage', 31922)).toBe('garbage');
  });
});

describe('formatEventDateTime — map popup', () => {
  it('shows date only for kind 31922 — no fabricated 00:00', () => {
    const s = formatEventDateTime({ kind: 31922, start: JAN_5 });
    expect(s).not.toBe('');
    expect(s).not.toMatch(TIME_PATTERN);
    expect(s).not.toContain(' at ');
  });

  it('shows date and time for kind 31923', () => {
    const s = formatEventDateTime({ kind: 31923, start: JAN_5_15H });
    expect(s).toContain(' at ');
    expect(s).toMatch(TIME_PATTERN);
  });

  it('returns empty string without a start', () => {
    expect(formatEventDateTime({ kind: 31923, start: 0 })).toBe('');
  });
});

describe('getIcsEventTiming — ICS export bounds', () => {
  const allDay = (tags) => ({ kind: 31922, tags });
  const timed = (tags) => ({ kind: 31923, tags });

  it('parses a 31922 ISO end date (inclusive) into an exclusive DTEND day', () => {
    const t = getIcsEventTiming(
      allDay([
        ['start', '2026-01-05'],
        ['end', '2026-01-07']
      ])
    );
    expect(t).toEqual({ isAllDay: true, start: JAN_5, end: JAN_5 + 3 * DAY });
  });

  it('31922 without end spans exactly one day', () => {
    const t = getIcsEventTiming(allDay([['start', '2026-01-05']]));
    expect(t).toEqual({ isAllDay: true, start: JAN_5, end: JAN_5 + DAY });
  });

  it('31923 keeps its end timestamp', () => {
    const t = getIcsEventTiming(
      timed([
        ['start', String(JAN_5_15H)],
        ['end', String(JAN_5_15H + 3600)]
      ])
    );
    expect(t).toEqual({ isAllDay: false, start: JAN_5_15H, end: JAN_5_15H + 3600 });
  });

  it('31923 without end has no fabricated end (open end)', () => {
    const t = getIcsEventTiming(timed([['start', String(JAN_5_15H)]]));
    expect(t).toEqual({ isAllDay: false, start: JAN_5_15H, end: null });
  });

  it('returns null without a parseable start', () => {
    expect(getIcsEventTiming(timed([]))).toBeNull();
    expect(getIcsEventTiming(allDay([['start', 'garbage']]))).toBeNull();
  });
});

describe('dedupeReplaceableEvents — one appointment per address', () => {
  const PK = 'a'.repeat(64);
  const version = (id, created_at, dTag = 'party', kind = 31923) => ({
    id,
    kind,
    pubkey: PK,
    created_at,
    tags: [['d', dTag]]
  });

  it('keeps only the newest version of the same kind:pubkey:d address', () => {
    const out = dedupeReplaceableEvents([version('old', 100), version('new', 200)]);
    expect(out.map((e) => e.id)).toEqual(['new']);
  });

  it('breaks created_at ties by lower id (NIP-01)', () => {
    const out = dedupeReplaceableEvents([version('bbb', 100), version('aaa', 100)]);
    expect(out.map((e) => e.id)).toEqual(['aaa']);
  });

  it('keeps events at different addresses', () => {
    const out = dedupeReplaceableEvents([version('e1', 100, 'one'), version('e2', 100, 'two')]);
    expect(out).toHaveLength(2);
  });

  it('passes non-replaceable events through keyed by id', () => {
    const a = { id: 'x', kind: 1, pubkey: PK, created_at: 1, tags: [] };
    const b = { id: 'y', kind: 1, pubkey: PK, created_at: 2, tags: [] };
    expect(dedupeReplaceableEvents([a, b, a])).toHaveLength(2);
  });
});
