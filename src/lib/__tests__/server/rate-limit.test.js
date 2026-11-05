/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '$lib/server/rate-limit.js';

describe('createRateLimiter', () => {
  it('allows up to max hits per window, then refuses with the wait in seconds', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 2, windowMs: 60_000, now: () => now });
    expect(limit('1.2.3.4')).toBe(0);
    expect(limit('1.2.3.4')).toBe(0);
    expect(limit('1.2.3.4')).toBe(60);
    now = 30_000;
    expect(limit('1.2.3.4')).toBe(30);
  });

  it('counts each client separately and resets after the window', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now });
    expect(limit('a')).toBe(0);
    expect(limit('b')).toBe(0);
    expect(limit('a')).toBeGreaterThan(0);
    now = 1_000;
    expect(limit('a')).toBe(0);
  });

  it('drops expired clients so the map does not grow without bound', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now });
    for (let i = 0; i < 1000; i++) limit(`ip-${i}`);
    now = 2_000;
    limit('fresh');
    expect(limit.size()).toBe(1);
  });
});
