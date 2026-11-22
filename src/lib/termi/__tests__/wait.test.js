/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { waitSeconds, WAIT_NOTICE_MS } from '../wait.js';

describe('waitSeconds: the wait card countdown', () => {
  it('the start cut minus the wait so far, rounded to 5', () => {
    expect(waitSeconds('ask', false, WAIT_NOTICE_MS)).toBe(20); // 30 − 8 = 22 → 20
    expect(waitSeconds('lesson', false, WAIT_NOTICE_MS)).toBe(80); // 90 − 8 = 82 → 80
    expect(waitSeconds('ask', false, 12_000)).toBe(20); // 18 → 20
  });
  it('never below 5', () => {
    expect(waitSeconds('ask', false, 29_000)).toBe(5);
    expect(waitSeconds('ask', false, 60_000)).toBe(5);
  });
  it('the last candidate waits the longer cut', () => {
    expect(waitSeconds('ask', true, WAIT_NOTICE_MS)).toBe(80); // 90 − 8
    expect(waitSeconds('lesson', true, WAIT_NOTICE_MS)).toBe(140); // 150 − 8
  });
});
