/** @vitest-environment node */
// Pure decision behind the bottom sheet's pull-down: a long pull or a quick
// flick dismisses, a short slow pull snaps back.
import { describe, it, expect } from 'vitest';
import { shouldDismiss } from '../helpers/swipe-dismiss.js';

describe('shouldDismiss', () => {
  it('dismisses after a long pull regardless of speed', () => {
    expect(shouldDismiss({ dy: 130, elapsed: 2000, height: 600 })).toBe(true);
  });

  it('scales the distance threshold down for short sheets (30 % of the height)', () => {
    expect(shouldDismiss({ dy: 70, elapsed: 2000, height: 200 })).toBe(true);
    expect(shouldDismiss({ dy: 50, elapsed: 2000, height: 200 })).toBe(false);
  });

  it('keeps the fixed threshold when the sheet height is unknown', () => {
    expect(shouldDismiss({ dy: 60, elapsed: 2000, height: 0 })).toBe(false);
    expect(shouldDismiss({ dy: 120, elapsed: 2000, height: 0 })).toBe(true);
  });

  it('dismisses a quick flick that did not travel far', () => {
    expect(shouldDismiss({ dy: 40, elapsed: 40, height: 600 })).toBe(true);
  });

  it('snaps back after a short slow pull or an upward move', () => {
    expect(shouldDismiss({ dy: 40, elapsed: 800, height: 600 })).toBe(false);
    expect(shouldDismiss({ dy: 10, elapsed: 5, height: 600 })).toBe(false);
    expect(shouldDismiss({ dy: -200, elapsed: 10, height: 600 })).toBe(false);
  });
});
