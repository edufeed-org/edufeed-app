/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetLocale = vi.hoisted(() => vi.fn(() => 'en'));
vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: mockGetLocale
}));

import { formatDate, formatTimestamp } from '$lib/helpers/dates.js';

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
