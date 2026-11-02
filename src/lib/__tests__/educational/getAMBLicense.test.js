/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getAMBLicense,
  getAMBLicenseIds,
  preserveLicenseIdTags,
  formatAMBResource
} from '$lib/helpers/educational/ambHelpers.js';
import { buildTulluCitation, getCitationOrigin } from '$lib/helpers/educational/citation.js';

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

const KIM = 'https://w3id.org/kim/license/';

// LEHRE LADEN (lehreladen.rub.de) resource as harvested: two KIM license-type
// tags that together mean CC BY-SA.
const lehreLaden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/lehreladen-kim-license.json', import.meta.url)),
    'utf8'
  )
);

describe('getAMBLicense — several license:id tags', () => {
  it('composes KIM attribution + shareAlike into CC BY-SA (KIM)', () => {
    const e = {
      tags: [
        ['license:id', `${KIM}attribution`],
        ['license:id', `${KIM}shareAlike`]
      ]
    };
    expect(getAMBLicense(e)).toEqual({ id: `${KIM}attribution`, label: 'CC BY-SA (KIM)' });
  });

  it('single KIM attribution → CC BY (KIM)', () => {
    expect(getAMBLicense(evt(`${KIM}attribution`))?.label).toBe('CC BY (KIM)');
  });

  it('KIM nonCommercial-noDerivatives → CC BY-NC-ND (KIM)', () => {
    expect(getAMBLicense(evt(`${KIM}nonCommercial-noDerivatives`))?.label).toBe(
      'CC BY-NC-ND (KIM)'
    );
  });

  it('a CC URI next to KIM concepts wins', () => {
    const e = {
      tags: [
        ['license:id', `${KIM}attribution`],
        ['license:id', 'https://creativecommons.org/licenses/by-nc/4.0/']
      ]
    };
    expect(getAMBLicense(e)).toEqual({
      id: 'https://creativecommons.org/licenses/by-nc/4.0/',
      label: 'CC BY-NC 4.0'
    });
  });

  it('falls back to a plain license tag', () => {
    const url = 'https://creativecommons.org/licenses/by/4.0/';
    expect(getAMBLicenseIds({ tags: [['license', url]] })).toEqual([url]);
    expect(getAMBLicense({ tags: [['license', url]] })?.label).toBe('CC BY 4.0');
  });
});

describe('TULLU citation for the LEHRE LADEN sample', () => {
  it('names the composed license and keeps the license link', () => {
    const resource = /** @type {any} */ (formatAMBResource(lehreLaden, 'de'));
    expect(resource.license).toEqual({ id: `${KIM}attribution`, label: 'CC BY-SA (KIM)' });
    const { text, html } = buildTulluCitation({
      title: resource.name,
      creators: ['LEHRE LADEN'],
      license: resource.license,
      origin: getCitationOrigin(resource, { pageUrl: 'https://edufeed.org/x', appName: 'Edufeed' })
    });
    expect(text).toBe(
      '„Startseite“ von LEHRE LADEN unter der Lizenz CC BY-SA (KIM) (https://w3id.org/kim/license/attribution) via lehreladen.rub.de (https://lehreladen.rub.de/)'
    );
    expect(html).toContain(
      '<a href="https://w3id.org/kim/license/attribution" target="_blank" rel="noopener noreferrer license">CC BY-SA (KIM)</a>'
    );
  });
});

describe('preserveLicenseIdTags', () => {
  const original = [`${KIM}attribution`, `${KIM}shareAlike`];

  it('re-inserts the extra original license:id tags after the unchanged first one', () => {
    const tags = [
      ['d', 'x'],
      ['license:id', `${KIM}attribution`],
      ['name', 'n']
    ];
    expect(preserveLicenseIdTags(tags, original)).toEqual([
      ['d', 'x'],
      ['license:id', `${KIM}attribution`],
      ['license:id', `${KIM}shareAlike`],
      ['name', 'n']
    ]);
  });

  it('drops them when the user picked a different license', () => {
    const tags = [['license:id', 'https://creativecommons.org/licenses/by/4.0/']];
    expect(preserveLicenseIdTags(tags, original)).toEqual([
      ['license:id', 'https://creativecommons.org/licenses/by/4.0/']
    ]);
  });

  it('is a no-op for single-license originals', () => {
    const tags = [['license:id', `${KIM}attribution`]];
    expect(preserveLicenseIdTags(tags, [`${KIM}attribution`])).toEqual(tags);
    expect(preserveLicenseIdTags(tags, undefined)).toEqual(tags);
  });
});
