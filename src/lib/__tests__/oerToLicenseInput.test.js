// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  oerToLicenseInput,
  isOerItemLicensable,
  deriveOerCredit
} from '$lib/helpers/oer/oerToLicenseInput.js';

const asset = { sha256: 'abc123', mime: 'image/jpeg', size: 4242 };

function baseItem(overrides = {}) {
  return {
    id: 'openverse:1',
    amb: {
      id: 'https://img.example/tree.jpg',
      name: 'A Tree',
      license: { id: 'https://creativecommons.org/licenses/by/4.0/' },
      creator: [{ name: 'Jane Photographer' }]
    },
    extensions: {
      system: {
        attribution: '"A Tree" by Jane, CC BY 4.0',
        foreignLandingUrl: 'https://openverse.org/image/1'
      },
      fileMetadata: { fileDim: '1920x1080' }
    },
    ...overrides
  };
}

describe('oerToLicenseInput', () => {
  it('maps a fully-populated item', () => {
    const input = oerToLicenseInput(baseItem(), asset);
    expect(input).toEqual({
      url: 'https://img.example/tree.jpg',
      hash: 'abc123',
      mime: 'image/jpeg',
      size: 4242,
      license: 'https://creativecommons.org/licenses/by/4.0/',
      credit: '"A Tree" by Jane, CC BY 4.0',
      source: 'https://openverse.org/image/1',
      title: 'A Tree',
      dim: '1920x1080'
    });
  });

  it('falls back credit to composed creator names when attribution absent', () => {
    const item = baseItem();
    delete item.extensions.system.attribution;
    const input = oerToLicenseInput(item, asset);
    expect(input.credit).toBe('Jane Photographer');
  });

  it('falls back source to amb.id when foreignLandingUrl absent', () => {
    const item = baseItem();
    delete item.extensions.system.foreignLandingUrl;
    const input = oerToLicenseInput(item, asset);
    expect(input.source).toBe('https://img.example/tree.jpg');
  });

  it('returns null when no license id can be resolved', () => {
    const item = baseItem();
    delete item.amb.license;
    expect(oerToLicenseInput(item, asset)).toBeNull();
  });

  it('returns null when no credit can be resolved', () => {
    const item = baseItem();
    delete item.extensions.system.attribution;
    delete item.amb.creator;
    expect(oerToLicenseInput(item, asset)).toBeNull();
  });
});

describe('deriveOerCredit', () => {
  it('prefers system.attribution', () => {
    expect(deriveOerCredit(baseItem())).toBe('"A Tree" by Jane, CC BY 4.0');
  });

  it('falls back to composed creator names', () => {
    const item = baseItem();
    delete item.extensions.system.attribution;
    expect(deriveOerCredit(item)).toBe('Jane Photographer');
  });

  it('returns empty string when neither is present', () => {
    const item = baseItem();
    delete item.extensions.system.attribution;
    delete item.amb.creator;
    expect(deriveOerCredit(item)).toBe('');
  });
});

describe('isOerItemLicensable', () => {
  it('is true for a fully-populated item', () => {
    expect(isOerItemLicensable(baseItem())).toBe(true);
  });

  it('is false without a license id', () => {
    const item = baseItem();
    delete item.amb.license;
    expect(isOerItemLicensable(item)).toBe(false);
  });

  it('is false without a resolvable credit', () => {
    const item = baseItem();
    delete item.extensions.system.attribution;
    delete item.amb.creator;
    expect(isOerItemLicensable(item)).toBe(false);
  });

  it('is false without a url (amb.id)', () => {
    const item = baseItem();
    delete item.amb.id;
    expect(isOerItemLicensable(item)).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(isOerItemLicensable(null)).toBe(false);
    expect(isOerItemLicensable(undefined)).toBe(false);
  });
});
