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

  it('formats MIT (legacy)', () => {
    expect(formatLicenseUrl('https://opensource.org/licenses/MIT')).toBe('MIT License');
  });

  it('formats Pixabay', () => {
    expect(formatLicenseUrl('https://pixabay.com/service/license-summary/')).toBe(
      'Pixabay License'
    );
  });

  it('formats Canva', () => {
    expect(formatLicenseUrl('https://www.canva.com/policies/content-license-agreement/')).toBe(
      'Canva Content License'
    );
  });

  it('formats Urheberrechtlich geschützt', () => {
    expect(formatLicenseUrl('https://de.wikipedia.org/wiki/Urheberrecht_(Deutschland)')).toBe(
      'Urheberrechtlich geschützt'
    );
  });

  it('formats Unsplash', () => {
    expect(formatLicenseUrl('https://unsplash.com/license')).toBe('Unsplash License');
  });

  it('formats CC Public Domain Mark', () => {
    expect(formatLicenseUrl('https://creativecommons.org/publicdomain/mark/1.0/')).toBe(
      'Public Domain'
    );
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
