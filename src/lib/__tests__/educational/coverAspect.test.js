/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  clampCoverAspect,
  clampCardAspect,
  COVER_ASPECT_MIN,
  COVER_ASPECT_MAX,
  CARD_ASPECT_MIN,
  CARD_ASPECT_MAX
} from '$lib/helpers/educational/coverAspect.js';

describe('clampCardAspect — adaptive feed/grid card cover frame', () => {
  it('passes square and moderate landscape ratios through unchanged', () => {
    expect(clampCardAspect(800, 800)).toBeCloseTo(1);
    expect(clampCardAspect(4, 3)).toBeCloseTo(4 / 3);
    expect(clampCardAspect(1920, 1080)).toBeCloseTo(16 / 9);
  });

  it('never goes taller than square — portrait covers get a bounded frame', () => {
    expect(CARD_ASPECT_MIN).toBe(1);
    expect(clampCardAspect(600, 800)).toBeCloseTo(CARD_ASPECT_MIN);
  });

  it('clamps extreme panoramas to the shared max ratio', () => {
    expect(CARD_ASPECT_MAX).toBeCloseTo(COVER_ASPECT_MAX);
    expect(clampCardAspect(3000, 1000)).toBeCloseTo(CARD_ASPECT_MAX);
  });

  it('falls back to the widest frame for unusable dimensions', () => {
    expect(clampCardAspect(0, 100)).toBeCloseTo(CARD_ASPECT_MAX);
    expect(clampCardAspect(100, 0)).toBeCloseTo(CARD_ASPECT_MAX);
    expect(clampCardAspect(NaN, 100)).toBeCloseTo(CARD_ASPECT_MAX);
    expect(clampCardAspect(undefined, undefined)).toBeCloseTo(CARD_ASPECT_MAX);
  });
});

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
