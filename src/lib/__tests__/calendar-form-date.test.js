/**
 * formDateFromTimestamp — the `YYYY-MM-DD` an event dialog shows for a
 * stored start/end. All-day (31922) values are midnight UTC and the writer
 * reads the form date back as UTC, so their day is the UTC day in every
 * zone; timed (31923) values are instants, shown on the viewer's local day.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import { formDateFromTimestamp } from '$lib/helpers/calendar-timing.js';

// Node re-reads process.env.TZ per date operation (see upcoming-date-parts).
const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const SEP_17_UTC = Date.UTC(2026, 8, 17) / 1000; // all-day start
const SEP_17_2230_UTC = Date.UTC(2026, 8, 17, 22, 30) / 1000;
const SEP_18_0130_UTC = Date.UTC(2026, 8, 18, 1, 30) / 1000;

describe('formDateFromTimestamp', () => {
  it('keeps the all-day day west of UTC (no shift back on edit)', () => {
    process.env.TZ = 'America/New_York';
    expect(formDateFromTimestamp(SEP_17_UTC, 31922)).toBe('2026-09-17');
  });

  it('keeps the all-day day east of UTC', () => {
    process.env.TZ = 'Pacific/Auckland';
    expect(formDateFromTimestamp(SEP_17_UTC, 31922)).toBe('2026-09-17');
  });

  it('shows a timed event on the local day east of UTC', () => {
    process.env.TZ = 'Europe/Berlin';
    expect(formDateFromTimestamp(SEP_17_2230_UTC, 31923)).toBe('2026-09-18');
  });

  it('shows a timed event on the local day west of UTC', () => {
    process.env.TZ = 'America/New_York';
    expect(formDateFromTimestamp(SEP_18_0130_UTC, 31923)).toBe('2026-09-17');
  });
});
