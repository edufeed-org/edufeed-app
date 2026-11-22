// @ts-nocheck
/**
 * QA round 3 K5: the calendar's weekday headers were hard-coded English
 * ("Mon Tue …" in the German UI) and its month/day names followed the
 * deployment's CALENDAR_LOCALE ("Oktober 2026" in the English UI). Both
 * follow the app (Paraglide) locale now.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const locale = vi.hoisted(() => ({ tag: 'de' }));
vi.mock('$lib/paraglide/runtime.js', () => ({ getLocale: () => locale.tag }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { calendar: { timeFormat: '24h', weekStartDay: 1 } }
}));

const { getWeekdayHeaders, formatCalendarDate, formatRelativeTime } = await import(
  '$lib/helpers/calendar.js'
);

const OCT_2 = new Date(2026, 9, 2, 12, 0);

beforeEach(() => {
  locale.tag = 'de';
});

describe('calendar names follow the app locale', () => {
  it('German UI: Mo … So, "Oktober 2026", "Freitag, 2. Oktober 2026"', () => {
    expect(getWeekdayHeaders()).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(formatCalendarDate(OCT_2, 'month')).toBe('Oktober 2026');
    expect(formatCalendarDate(OCT_2, 'long')).toContain('Freitag');
  });
  it('English UI: Mon … Sun, "October 2026", "Friday …"', () => {
    locale.tag = 'en';
    expect(getWeekdayHeaders()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(formatCalendarDate(OCT_2, 'month')).toBe('October 2026');
    expect(formatCalendarDate(OCT_2, 'long')).toContain('Friday');
  });
});

describe("'short' dates carry the year once it is not the current one", () => {
  it('this year: "15. Jan."; last year: "12. Dez. <year>" (cards, relative times)', () => {
    const now = new Date();
    const thisYear = new Date(now.getFullYear(), 0, 15, 12);
    const lastYear = new Date(now.getFullYear() - 1, 11, 12, 12);
    expect(formatCalendarDate(thisYear, 'short')).toBe('15. Jan.');
    expect(formatCalendarDate(lastYear, 'short')).toBe(`12. Dez. ${now.getFullYear() - 1}`);
    expect(formatRelativeTime(lastYear.getTime() / 1000)).toBe(`12. Dez. ${now.getFullYear() - 1}`);
  });
});
