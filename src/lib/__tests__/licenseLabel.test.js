/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { formatLicenseUrl, formatLicenseIds } from '$lib/helpers/educational/licenseLabel.js';

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

  it('does not mistake CC deed/legalcode pages for a jurisdiction', () => {
    // 14 of 15 live AMB resources carry deed.de URLs — used to render "CC BY 4.0 DEE"
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by/4.0/deed.de')).toBe(
      'CC BY 4.0'
    );
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-sa/4.0/deed.en')).toBe(
      'CC BY-SA 4.0'
    );
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by-nc-sa/3.0/de/legalcode')).toBe(
      'CC BY-NC-SA 3.0 DE'
    );
    expect(formatLicenseUrl('https://creativecommons.org/licenses/by/4.0')).toBe('CC BY 4.0');
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

const KIM = 'https://w3id.org/kim/license/';

describe('formatLicenseUrl — KIM license types and free licences', () => {
  it('labels a single KIM concept instead of returning the raw URI', () => {
    expect(formatLicenseUrl(`${KIM}attribution`)).toBe('CC BY (KIM)');
    expect(formatLicenseUrl(`${KIM}nonCommercial-noDerivatives`)).toBe('CC BY-NC-ND (KIM)');
    expect(formatLicenseUrl(`${KIM}noLicense`)).toBe('Keine Lizenz');
    expect(formatLicenseUrl(`${KIM}publicDomain`)).toBe('Public Domain (KIM)');
    expect(formatLicenseUrl(`${KIM}unknownTerm`)).toBe(`${KIM}unknownTerm`);
  });

  it('labels GNU, Apache, BSD, MIT and SPDX licence URIs', () => {
    expect(formatLicenseUrl('https://www.gnu.org/licenses/gpl-3.0-standalone.html')).toBe(
      'GPL-3.0'
    );
    expect(formatLicenseUrl('http://www.gnu.org/licenses/gpl-3.0')).toBe('GPL-3.0');
    expect(formatLicenseUrl('https://www.gnu.org/licenses/fdl-1.3.html')).toBe('GFDL-1.3');
    expect(formatLicenseUrl('https://www.gnu.org/licenses/lgpl-2.1.txt')).toBe('LGPL-2.1');
    expect(formatLicenseUrl('https://opensource.org/license/mit')).toBe('MIT License');
    expect(formatLicenseUrl('https://www.apache.org/licenses/LICENSE-2.0')).toBe('Apache-2.0');
    expect(formatLicenseUrl('https://opensource.org/license/bsd-3-clause')).toBe('BSD-3-Clause');
    expect(formatLicenseUrl('https://spdx.org/licenses/GPL-3.0-or-later.html')).toBe(
      'GPL-3.0-or-later'
    );
    expect(formatLicenseUrl('https://example.org/my-license')).toBe(
      'https://example.org/my-license'
    );
  });
});

describe('formatLicenseIds — all license:id values of a resource', () => {
  it('returns null without values', () => {
    expect(formatLicenseIds([])).toBeNull();
    expect(formatLicenseIds(['', '  '])).toBeNull();
  });

  it('single KIM attribution → CC BY (KIM), linked to the KIM concept', () => {
    expect(formatLicenseIds([`${KIM}attribution`])).toEqual({
      id: `${KIM}attribution`,
      label: 'CC BY (KIM)'
    });
  });

  it('KIM attribution + shareAlike compose CC BY-SA (KIM)', () => {
    expect(formatLicenseIds([`${KIM}attribution`, `${KIM}shareAlike`])).toEqual({
      id: `${KIM}attribution`,
      label: 'CC BY-SA (KIM)'
    });
  });

  it('composes nc/nd variants; attribution is implied', () => {
    expect(formatLicenseIds([`${KIM}nonCommercial-noDerivatives`])?.label).toBe(
      'CC BY-NC-ND (KIM)'
    );
    expect(formatLicenseIds([`${KIM}attribution`, `${KIM}nonCommercial`])?.label).toBe(
      'CC BY-NC (KIM)'
    );
    expect(
      formatLicenseIds([`${KIM}nonCommercial`, `${KIM}shareAlike`, `${KIM}attribution`])?.label
    ).toBe('CC BY-NC-SA (KIM)');
  });

  it('noLicense → Keine Lizenz; publicDomain alone → Public Domain (KIM)', () => {
    expect(formatLicenseIds([`${KIM}attribution`, `${KIM}noLicense`])?.label).toBe('Keine Lizenz');
    expect(formatLicenseIds([`${KIM}publicDomain`])?.label).toBe('Public Domain (KIM)');
  });

  it('contradictory KIM sets show the raw first URI', () => {
    expect(formatLicenseIds([`${KIM}shareAlike`, `${KIM}noDerivatives`])).toEqual({
      id: `${KIM}shareAlike`,
      label: `${KIM}shareAlike`
    });
    expect(formatLicenseIds([`${KIM}publicDomain`, `${KIM}attribution`])?.label).toBe(
      `${KIM}publicDomain`
    );
  });

  it('a Creative Commons URI wins over KIM concepts', () => {
    expect(
      formatLicenseIds([`${KIM}attribution`, 'https://creativecommons.org/licenses/by-nc/4.0/'])
    ).toEqual({ id: 'https://creativecommons.org/licenses/by-nc/4.0/', label: 'CC BY-NC 4.0' });
  });

  it('otherwise the first labelled value, else the raw first value', () => {
    expect(
      formatLicenseIds(['https://example.org/x', 'https://www.gnu.org/licenses/gpl-3.0.html'])
    ).toEqual({ id: 'https://www.gnu.org/licenses/gpl-3.0.html', label: 'GPL-3.0' });
    expect(formatLicenseIds(['https://example.org/x'])).toEqual({
      id: 'https://example.org/x',
      label: 'https://example.org/x'
    });
  });
});
