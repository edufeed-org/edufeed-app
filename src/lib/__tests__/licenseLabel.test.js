/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';

describe('formatLicenseUrl', () => {
  it('formats CC 4.0 international variants', () => {
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by/4.0/')).toBe('CC BY 4.0');
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-sa/4.0/')).toBe(
      'CC BY-SA 4.0'
    );
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-nc/4.0/')).toBe(
      'CC BY-NC 4.0'
    );
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe(
      'CC BY-NC-SA 4.0'
    );
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-nd/4.0/')).toBe(
      'CC BY-ND 4.0'
    );
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-nc-nd/4.0/')).toBe(
      'CC BY-NC-ND 4.0'
    );
  });

  it('formats CC 3.0 with locale jurisdiction (de)', () => {
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-nc-sa/3.0/de/')).toBe(
      'CC BY-NC-SA 3.0 DE'
    );
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by/3.0/de/')).toBe(
      'CC BY 3.0 DE'
    );
  });

  it('formats CC0 public domain', () => {
    expect(formatLicenseUrl('https://creativecommons.org/publicdomain/zero/1.0/')).toBe(
      'CC0 (Public Domain)'
    );
  });

  it('formats MIT', () => {
    expect(formatLicenseUrl('https://opensource.org/licenses/MIT')).toBe('MIT License');
  });

  it('returns the URL itself for unknown licenses', () => {
    expect(formatLicenseUrl('https://example.org/custom-license')).toBe(
      'https://example.org/custom-license'
    );
  });

  it('handles missing trailing slash', () => {
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-nc-sa/3.0/de')).toBe(
      'CC BY-NC-SA 3.0 DE'
    );
  });
});
