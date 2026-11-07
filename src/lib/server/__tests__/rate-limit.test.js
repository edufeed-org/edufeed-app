/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRateLimiter } from '../rate-limit.js';

describe('createRateLimiter', () => {
  afterEach(() => vi.useRealTimers());

  it('allows up to `limit` calls per key within the window, then blocks', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
  });

  it('allows calls again once the window has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    vi.setSystemTime(1_001);
    expect(limiter.take('a')).toBe(true);
  });

  it('sweeps fully-expired keys once the window has passed, shrinking size()', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = createRateLimiter({ limit: 5, windowMs: 1_000 });
    limiter.take('a');
    limiter.take('b');
    expect(limiter.size()).toBe(2);

    // Past the window: the next take() (for a different key) sweeps 'a'/'b'.
    vi.setSystemTime(5_000);
    limiter.take('c');
    expect(limiter.size()).toBe(1);
  });

  it('forgets a key windowMs after its last allowed call, with no further traffic', () => {
    // The privacy policy promises the router keeps an IP at most a minute.
    vi.useFakeTimers();
    const limiter = createRateLimiter({ limit: 5, windowMs: 1_000 });
    limiter.take('a');
    vi.advanceTimersByTime(600);
    limiter.take('a');
    vi.advanceTimersByTime(999);
    expect(limiter.size()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(limiter.size()).toBe(0);
  });

  it('never grows size() beyond distinct keys seen within one window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = createRateLimiter({ limit: 100, windowMs: 1_000 });
    for (let i = 0; i < 50; i++) {
      limiter.take(`ip-${i}`);
    }
    expect(limiter.size()).toBe(50);
    vi.setSystemTime(1_001);
    limiter.take('ip-fresh');
    // the sweep triggered by this call drops all 50 expired keys
    expect(limiter.size()).toBe(1);
  });
});
