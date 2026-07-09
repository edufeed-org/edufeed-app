/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetLocale = vi.hoisted(() => vi.fn(() => 'en'));
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: mockGetLocale
}));

import {
  formatDate,
  formatTimestamp,
  isoToGermanDate,
  germanDateToIso,
  parseDateInput
} from '$lib/helpers/dates.js';

const SAMPLE = new Date(Date.UTC(2026, 5, 3)); // 2026-06-03 UTC
const SAMPLE_SECONDS = Math.floor(SAMPLE.getTime() / 1000);

describe('formatDate', () => {
  beforeEach(() => {
    mockGetLocale.mockReset();
  });

  it('uses en-GB (DD/MM/YYYY) when paraglide locale is "en"', () => {
    mockGetLocale.mockReturnValue('en');
    expect(formatDate(SAMPLE)).toBe('03/06/2026');
  });

  it('uses de-DE (DD.MM.YYYY) when paraglide locale is "de"', () => {
    mockGetLocale.mockReturnValue('de');
    expect(formatDate(SAMPLE)).toBe('3.6.2026');
  });

  it('falls back to de-DE for an unmapped locale', () => {
    mockGetLocale.mockReturnValue('fr');
    expect(formatDate(SAMPLE)).toBe('3.6.2026');
  });

  it('falls back to de-DE when getLocale throws', () => {
    mockGetLocale.mockImplementation(() => {
      throw new Error('not initialised');
    });
    expect(formatDate(SAMPLE)).toBe('3.6.2026');
  });

  it('never returns the US slash format (M/D/YYYY) for the default fallback', () => {
    mockGetLocale.mockReturnValue('en');
    const out = formatDate(SAMPLE);
    expect(out).not.toBe('6/3/2026');
  });

  it('passes through Intl options', () => {
    mockGetLocale.mockReturnValue('de');
    const out = formatDate(SAMPLE, { year: 'numeric', month: 'long', day: 'numeric' });
    expect(out).toMatch(/Juni/);
  });
});

describe('formatTimestamp', () => {
  beforeEach(() => {
    mockGetLocale.mockReset();
    mockGetLocale.mockReturnValue('en');
  });

  it('converts seconds-since-epoch to a formatted date', () => {
    expect(formatTimestamp(SAMPLE_SECONDS)).toBe('03/06/2026');
  });
});

describe('isoToGermanDate', () => {
  it('converts an ISO date to DD.MM.YYYY', () => {
    expect(isoToGermanDate('2018-05-03')).toBe('03.05.2018');
  });

  it('accepts the leading date portion of a full datetime', () => {
    expect(isoToGermanDate('2018-05-03T12:34:56Z')).toBe('03.05.2018');
  });

  it('trims surrounding whitespace', () => {
    expect(isoToGermanDate('  2018-05-03  ')).toBe('03.05.2018');
  });

  it('returns "" for empty, nullish, or unparseable input', () => {
    expect(isoToGermanDate('')).toBe('');
    expect(isoToGermanDate(undefined)).toBe('');
    expect(isoToGermanDate(null)).toBe('');
    expect(isoToGermanDate('03.05.2018')).toBe('');
  });
});

describe('germanDateToIso', () => {
  it('converts DD.MM.YYYY to ISO YYYY-MM-DD', () => {
    expect(germanDateToIso('03.05.2018')).toBe('2018-05-03');
  });

  it('tolerates single-digit day and month, zero-padding the output', () => {
    expect(germanDateToIso('3.5.2018')).toBe('2018-05-03');
  });

  it('trims surrounding whitespace', () => {
    expect(germanDateToIso('  3.5.2018  ')).toBe('2018-05-03');
  });

  it('returns "" for incomplete input', () => {
    expect(germanDateToIso('3.5')).toBe('');
    expect(germanDateToIso('3.5.20')).toBe('');
    expect(germanDateToIso('')).toBe('');
    expect(germanDateToIso(undefined)).toBe('');
    expect(germanDateToIso(null)).toBe('');
  });

  it('rejects overflow dates that JS would roll over (31.02)', () => {
    expect(germanDateToIso('31.02.2018')).toBe('');
    expect(germanDateToIso('31.04.2018')).toBe('');
  });

  it('round-trips with isoToGermanDate', () => {
    expect(germanDateToIso(isoToGermanDate('2026-06-19'))).toBe('2026-06-19');
  });
});

describe('parseDateInput', () => {
  it('accepts strict German DD.MM.YYYY like germanDateToIso', () => {
    expect(parseDateInput('03.05.2018')).toBe('2018-05-03');
    expect(parseDateInput('3.5.2018')).toBe('2018-05-03');
  });

  it('accepts 2-digit years with a 70 pivot (users type 15.03.24)', () => {
    expect(parseDateInput('15.03.24')).toBe('2024-03-15');
    expect(parseDateInput('1.2.05')).toBe('2005-02-01');
    expect(parseDateInput('24.12.98')).toBe('1998-12-24');
    expect(parseDateInput('01.01.70')).toBe('1970-01-01');
    expect(parseDateInput('31.12.69')).toBe('2069-12-31');
  });

  it('accepts pasted ISO YYYY-MM-DD', () => {
    expect(parseDateInput('2024-01-05')).toBe('2024-01-05');
    expect(parseDateInput('2024-1-5')).toBe('2024-01-05');
  });

  it('accepts slash and dash separators in German order', () => {
    expect(parseDateInput('15/03/2024')).toBe('2024-03-15');
    expect(parseDateInput('15-03-2024')).toBe('2024-03-15');
  });

  it('rejects 1- and 3-digit years so mid-typing input never parses eagerly', () => {
    expect(parseDateInput('15.03.2')).toBe('');
    expect(parseDateInput('15.03.202')).toBe('');
  });

  it('rejects incomplete, invalid, and overflow input', () => {
    expect(parseDateInput('3.5')).toBe('');
    expect(parseDateInput('abc')).toBe('');
    expect(parseDateInput('31.02.2018')).toBe('');
    expect(parseDateInput('2018-02-31')).toBe('');
    expect(parseDateInput('')).toBe('');
    expect(parseDateInput(undefined)).toBe('');
    expect(parseDateInput(null)).toBe('');
  });
});
