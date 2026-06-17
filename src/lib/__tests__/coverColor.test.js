/**
 * Pure-helper tests for cover-color persistence + parsing.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  COVER_COLOR_TAG,
  COVER_HUE_PRESETS,
  clampHue,
  getCoverHue,
  appendCoverColorTag
} from '$lib/helpers/educational/coverColor.js';

const evt = (tags) => ({ kind: 30142, tags, content: '' });

describe('clampHue', () => {
  it('returns an integer hue for valid numbers and numeric strings', () => {
    expect(clampHue(0)).toBe(0);
    expect(clampHue(200)).toBe(200);
    expect(clampHue('123')).toBe(123);
    expect(clampHue(123.7)).toBe(123);
  });
  it('returns null for out-of-range, non-numeric, null, undefined', () => {
    expect(clampHue(-1)).toBeNull();
    expect(clampHue(360)).toBeNull();
    expect(clampHue('nope')).toBeNull();
    expect(clampHue(null)).toBeNull();
    expect(clampHue(undefined)).toBeNull();
  });
});

describe('getCoverHue', () => {
  it('reads and clamps the cover_color tag', () => {
    expect(getCoverHue(evt([['cover_color', '210']]))).toBe(210);
  });
  it('returns null when the tag is absent', () => {
    expect(getCoverHue(evt([['title', 'x']]))).toBeNull();
  });
  it('returns null when the tag value is invalid', () => {
    expect(getCoverHue(evt([['cover_color', '999']]))).toBeNull();
  });
  it('tolerates missing/empty input', () => {
    expect(getCoverHue(undefined)).toBeNull();
    expect(getCoverHue(evt([]))).toBeNull();
  });
});

describe('appendCoverColorTag', () => {
  it('pushes one cover_color tag for a valid hue', () => {
    const tags = [];
    appendCoverColorTag(tags, 210);
    expect(tags).toEqual([['cover_color', '210']]);
  });
  it('is a no-op for null / invalid hue', () => {
    const tags = [];
    appendCoverColorTag(tags, null);
    appendCoverColorTag(tags, 999);
    expect(tags).toEqual([]);
  });
});

describe('COVER_HUE_PRESETS', () => {
  it('is a non-empty list of in-range integer hues', () => {
    expect(COVER_HUE_PRESETS.length).toBeGreaterThan(0);
    for (const h of COVER_HUE_PRESETS) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
  it('exposes the tag name constant', () => {
    expect(COVER_COLOR_TAG).toBe('cover_color');
  });
});
