/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getAMBLicense } from '$lib/helpers/educational/ambHelpers.js';

/**
 * @param {string} licenseId
 */
const evt = (licenseId) => ({ tags: [['license:id', licenseId]] });

describe('getAMBLicense', () => {
  it('returns null when no license:id tag is present', () => {
    expect(getAMBLicense({ tags: [['d', 'x']] })).toBeNull();
  });

  it('labels copyright/Urheberrecht URLs instead of showing the raw URL', () => {
    const url = 'https://de.wikipedia.org/wiki/Urheberrecht_(Deutschland)';
    expect(getAMBLicense(evt(url))).toEqual({ id: url, label: 'Urheberrechtlich geschützt' });
  });

  it('labels CC variants with the canonical "CC" prefix', () => {
    expect(getAMBLicense(evt('https://creativecommons.org/licenses/by/4.0/'))).toEqual({
      id: 'https://creativecommons.org/licenses/by/4.0/',
      label: 'CC BY 4.0'
    });
    expect(getAMBLicense(evt('https://creativecommons.org/licenses/by-nc-sa/3.0/de/'))).toEqual({
      id: 'https://creativecommons.org/licenses/by-nc-sa/3.0/de/',
      label: 'CC BY-NC-SA 3.0 DE'
    });
  });

  it('labels CC0 public domain', () => {
    expect(getAMBLicense(evt('https://creativecommons.org/publicdomain/zero/1.0/'))).toEqual({
      id: 'https://creativecommons.org/publicdomain/zero/1.0/',
      label: 'CC0 (Public Domain)'
    });
  });

  it('falls back to the raw URL for unknown licenses', () => {
    expect(getAMBLicense(evt('https://example.org/custom'))).toEqual({
      id: 'https://example.org/custom',
      label: 'https://example.org/custom'
    });
  });
});
