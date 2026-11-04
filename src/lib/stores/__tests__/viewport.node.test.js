/**
 * useIsDesktop without a window (SSR / node): reports desktop so nothing
 * phone-specific renders server-side.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { useIsDesktop } from '../viewport.svelte.js';

describe('useIsDesktop (no window)', () => {
  it('returns true', () => {
    expect(useIsDesktop()()).toBe(true);
  });
});
