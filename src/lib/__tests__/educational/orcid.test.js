/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { normalizeOrcid, isValidOrcid, ORCID_URI_PREFIX } from '$lib/helpers/educational/orcid.js';

// Known-valid ORCID iDs from the official ORCID documentation
const VALID = ['0000-0002-1825-0097', '0000-0001-5109-3700', '0000-0002-1694-233X'];

describe('isValidOrcid', () => {
  it('accepts known-valid ORCID iDs (bare form)', () => {
    for (const id of VALID) expect(isValidOrcid(id), id).toBe(true);
  });

  it('accepts full https URI form', () => {
    expect(isValidOrcid('https://orcid.org/0000-0002-1825-0097')).toBe(true);
  });

  it('rejects a checksum mismatch', () => {
    expect(isValidOrcid('0000-0002-1825-0096')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isValidOrcid('')).toBe(false);
    expect(isValidOrcid('not-an-orcid')).toBe(false);
    expect(isValidOrcid('0000-0002-1825')).toBe(false);
    expect(isValidOrcid('0000-0002-1825-00970')).toBe(false);
    expect(isValidOrcid(undefined)).toBe(false);
    expect(isValidOrcid(null)).toBe(false);
  });
});

describe('normalizeOrcid', () => {
  it('normalizes bare id to canonical https URI', () => {
    expect(normalizeOrcid('0000-0002-1825-0097')).toBe('https://orcid.org/0000-0002-1825-0097');
  });

  it('normalizes URI variants (http, www, trailing slash, lowercase x)', () => {
    expect(normalizeOrcid('http://orcid.org/0000-0002-1694-233x')).toBe(
      'https://orcid.org/0000-0002-1694-233X'
    );
    expect(normalizeOrcid('https://www.orcid.org/0000-0002-1825-0097/')).toBe(
      'https://orcid.org/0000-0002-1825-0097'
    );
    expect(normalizeOrcid('  0000-0001-5109-3700  ')).toBe('https://orcid.org/0000-0001-5109-3700');
  });

  it('accepts digits without hyphens', () => {
    expect(normalizeOrcid('0000000218250097')).toBe('https://orcid.org/0000-0002-1825-0097');
  });

  it('returns null for invalid input', () => {
    expect(normalizeOrcid('0000-0002-1825-0096')).toBe(null); // bad checksum
    expect(normalizeOrcid('hello')).toBe(null);
    expect(normalizeOrcid('')).toBe(null);
    expect(normalizeOrcid(undefined)).toBe(null);
  });

  it('exports the canonical prefix', () => {
    expect(ORCID_URI_PREFIX).toBe('https://orcid.org/');
  });
});
