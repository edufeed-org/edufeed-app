/** @vitest-environment node */
import { describe, test, expect } from 'vitest';
import { match } from '../resourceVariant.js';

describe('resourceVariant param matcher', () => {
  test('accepts any id registered in ALL_VARIANTS', () => {
    // Matcher must run server-side before runtime config loads, so it can't
    // depend on the enabled list. It accepts any registered variant id and
    // leaves enabled-list filtering to the page-level redirect.
    expect(match('amb')).toBe(true);
    expect(match('ekw')).toBe(true);
  });

  test('rejects an unknown variant id', () => {
    expect(match('not-a-real-variant')).toBe(false);
  });

  test('rejects the empty string', () => {
    expect(match('')).toBe(false);
  });
});
