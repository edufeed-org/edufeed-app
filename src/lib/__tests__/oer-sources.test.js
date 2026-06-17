/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  OER_SOURCES,
  ALLOWED_OER_SOURCE_IDS,
  parseRequestedSources
} from '$lib/config/oer-sources.js';

describe('oer-sources config', () => {
  it('exposes a non-empty source list, each with id/label/checked', () => {
    expect(OER_SOURCES.length).toBeGreaterThan(0);
    for (const s of OER_SOURCES) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(typeof s.checked).toBe('boolean');
    }
  });

  it('allowlist contains every source id and rejects unknowns', () => {
    expect(ALLOWED_OER_SOURCE_IDS.has('openverse')).toBe(true);
    expect(ALLOWED_OER_SOURCE_IDS.has('unsplash')).toBe(true);
    expect(ALLOWED_OER_SOURCE_IDS.has('evil-source')).toBe(false);
  });

  it('parses a csv of allowed ids, dropping unknowns and duplicates', () => {
    expect(parseRequestedSources('openverse,wikimedia')).toEqual(['openverse', 'wikimedia']);
    expect(parseRequestedSources('openverse,evil-source')).toEqual(['openverse']);
    expect(parseRequestedSources('openverse,openverse')).toEqual(['openverse']);
  });

  it('falls back to default-checked sources for empty/missing input', () => {
    const defaults = OER_SOURCES.filter((s) => s.checked).map((s) => s.id);
    expect(parseRequestedSources('')).toEqual(defaults);
    expect(parseRequestedSources(undefined)).toEqual(defaults);
    expect(parseRequestedSources(null)).toEqual(defaults);
  });
});
