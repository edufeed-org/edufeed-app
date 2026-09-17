/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { normalizeHandle } from '$lib/helpers/membership-applications.js';

describe('normalizeHandle', () => {
  it('lowercases and trims a typed handle', () => {
    expect(normalizeHandle('  Campus ')).toBe('campus');
  });

  it('leaves an already-canonical handle untouched', () => {
    expect(normalizeHandle('maria_m.2')).toBe('maria_m.2');
  });

  it('returns an empty string for missing or non-string input', () => {
    expect(normalizeHandle(undefined)).toBe('');
    expect(normalizeHandle(null)).toBe('');
    expect(normalizeHandle(42)).toBe('');
  });
});
