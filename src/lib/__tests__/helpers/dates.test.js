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
  germanDateToIso
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
