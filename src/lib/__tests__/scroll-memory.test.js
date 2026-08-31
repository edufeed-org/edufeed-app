/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveScrollPosition,
  recallScrollPosition,
  isNearBottom,
  __resetScrollMemory
} from '$lib/helpers/scroll-memory.js';

beforeEach(() => __resetScrollMemory());

describe('scroll memory', () => {
  it('recalls what was saved, per key', () => {
    saveScrollPosition('a@relay', { top: 420, atBottom: false });
    expect(recallScrollPosition('a@relay')).toEqual({ top: 420, atBottom: false });
    expect(recallScrollPosition('b@relay')).toBe(null);
  });

  it('ignores empty keys instead of throwing', () => {
    saveScrollPosition(null, { top: 1, atBottom: false });
    expect(recallScrollPosition(null)).toBe(null);
  });

  it('near-bottom is a band, not an exact pixel', () => {
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(isNearBottom({ scrollTop: 810, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(isNearBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });
});
