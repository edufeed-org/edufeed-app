/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  clampCoverAspect,
  COVER_ASPECT_MIN,
  COVER_ASPECT_MAX
} from '$lib/helpers/educational/coverAspect.js';

describe('clampCoverAspect — adaptive detail-view cover frame', () => {
  it('keeps the classic portrait ratio for portrait images', () => {
    expect(clampCoverAspect(600, 800)).toBeCloseTo(3 / 4);
  });

  it('passes through square and moderate landscape ratios unchanged', () => {
    expect(clampCoverAspect(800, 800)).toBeCloseTo(1);
    // 16:9 presentation slide — the case that used to get cropped to 3:4.
    expect(clampCoverAspect(1920, 1080)).toBeCloseTo(16 / 9);
    expect(clampCoverAspect(4, 3)).toBeCloseTo(4 / 3);
  });

  it('clamps extreme panoramas to the max ratio', () => {
    expect(clampCoverAspect(3000, 1000)).toBeCloseTo(COVER_ASPECT_MAX);
  });

  it('clamps extreme tall images to the portrait minimum', () => {
    expect(clampCoverAspect(900, 3200)).toBeCloseTo(COVER_ASPECT_MIN);
  });

  it('falls back to portrait for unusable dimensions', () => {
    expect(clampCoverAspect(0, 100)).toBeCloseTo(3 / 4);
    expect(clampCoverAspect(100, 0)).toBeCloseTo(3 / 4);
    expect(clampCoverAspect(NaN, 100)).toBeCloseTo(3 / 4);
    expect(clampCoverAspect(undefined, undefined)).toBeCloseTo(3 / 4);
  });
});
