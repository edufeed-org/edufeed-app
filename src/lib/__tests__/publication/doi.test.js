/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { normalizeDoi, isValidDoi, doiUrl } from '$lib/helpers/publication/doi.js';

describe('normalizeDoi', () => {
  it('accepts a bare DOI', () => {
    expect(normalizeDoi('10.5281/zenodo.569')).toBe('10.5281/zenodo.569');
  });

  it('strips doi: prefix and doi.org URLs', () => {
    expect(normalizeDoi('doi:10.5281/zenodo.569')).toBe('10.5281/zenodo.569');
    expect(normalizeDoi('https://doi.org/10.5281/zenodo.569')).toBe('10.5281/zenodo.569');
    expect(normalizeDoi('https://dx.doi.org/10.5281/zenodo.569')).toBe('10.5281/zenodo.569');
    expect(normalizeDoi('  10.5281/zenodo.569  ')).toBe('10.5281/zenodo.569');
  });

  it('returns null for invalid input', () => {
    expect(normalizeDoi('')).toBe(null);
    expect(normalizeDoi('11.5281/zenodo.569')).toBe(null);
    expect(normalizeDoi('10.5281')).toBe(null);
    expect(normalizeDoi('not a doi')).toBe(null);
    expect(normalizeDoi(undefined)).toBe(null);
  });
});

describe('isValidDoi', () => {
  it('mirrors normalizeDoi', () => {
    expect(isValidDoi('10.1234/abc-def')).toBe(true);
    expect(isValidDoi('nope')).toBe(false);
  });
});

describe('doiUrl', () => {
  it('builds the canonical resolver URL', () => {
    expect(doiUrl('10.5281/zenodo.569')).toBe('https://doi.org/10.5281/zenodo.569');
  });
});
