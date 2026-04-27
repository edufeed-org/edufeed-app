/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { isCacheableKind } from '$lib/stores/event-cache.svelte.js';

describe('isCacheableKind', () => {
  it('returns true for identity kinds', () => {
    [0, 3, 10002, 30002, 30000].forEach((k) => expect(isCacheableKind(k)).toBe(true));
  });

  it('returns true for NIP-09 deletion events', () => {
    expect(isCacheableKind(5)).toBe(true);
  });

  it('returns true for content kinds', () => {
    [10222, 30023, 30142, 31922, 31923, 31924].forEach((k) =>
      expect(isCacheableKind(k)).toBe(true)
    );
  });

  it('returns false for social / high-churn kinds', () => {
    [1, 7, 8, 9, 11, 1111, 9734, 9735, 31925].forEach((k) =>
      expect(isCacheableKind(k)).toBe(false)
    );
  });

  it('returns false for unknown kinds', () => {
    expect(isCacheableKind(99999)).toBe(false);
  });
});
