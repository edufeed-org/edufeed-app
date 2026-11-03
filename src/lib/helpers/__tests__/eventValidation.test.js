/**
 * validateCalendarEvent — a kind 31922 (date-based) event's `start`/`end`
 * tags are ISO 8601 date strings. `Date.parse` rolls an impossible day like
 * "2026-02-31" over into March, so a naive `new Date(...)` check accepts it.
 * Round-trip the parsed date back to a string (as `event-form-dates.js`
 * already does for the form) and reject anything that doesn't come back
 * unchanged.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { validateCalendarEvent } from '../eventValidation.js';

/** @param {string[][]} tags */
const dateEvent = (tags) => ({
  id: 'e'.repeat(64),
  pubkey: 'p'.repeat(64),
  kind: 31922,
  created_at: 1_700_000_000,
  content: '',
  tags: [['d', 'ev-1'], ['title', 'T'], ...tags]
});

describe('validateCalendarEvent — rollover dates', () => {
  it('rejects a start date that rolls over (2026-02-31 -> March)', () => {
    expect(validateCalendarEvent(dateEvent([['start', '2026-02-31']]))).toBe(false);
  });

  it('rejects an end date that rolls over', () => {
    expect(
      validateCalendarEvent(
        dateEvent([
          ['start', '2026-02-01'],
          ['end', '2026-02-31']
        ])
      )
    ).toBe(false);
  });

  it('accepts a real leap day', () => {
    expect(validateCalendarEvent(dateEvent([['start', '2024-02-29']]))).toBe(true);
  });

  it('rejects a non-leap-year Feb 29', () => {
    expect(validateCalendarEvent(dateEvent([['start', '2026-02-29']]))).toBe(false);
  });

  it('still accepts an ordinary valid date', () => {
    expect(validateCalendarEvent(dateEvent([['start', '2026-03-15']]))).toBe(true);
  });
});
