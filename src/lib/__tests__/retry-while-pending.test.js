/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { EMPTY, Subject } from 'rxjs';
import { retryWhilePending } from '$lib/helpers/retry-while-pending.js';

describe('retryWhilePending', () => {
  it('re-runs the load after each delay while something is still pending, then stops', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(() => EMPTY);
      let pending = true;
      const stop = retryWhilePending(load, () => pending, [3000, 10000]);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(load).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10000);
      expect(load).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(60000);
      expect(load).toHaveBeenCalledTimes(3); // delays used up

      load.mockClear();
      const stop2 = retryWhilePending(load, () => pending, [3000]);
      pending = false; // found meanwhile
      await vi.advanceTimersByTimeAsync(10000);
      expect(load).toHaveBeenCalledTimes(1);
      stop();
      stop2();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not start when nothing is pending and cancels a scheduled retry on stop', async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(() => EMPTY);
      retryWhilePending(load, () => false, [3000]);
      expect(load).not.toHaveBeenCalled();

      const live = new Subject();
      const load2 = vi.fn(() => live);
      const stop = retryWhilePending(load2, () => true, [3000]);
      stop();
      expect(live.observed).toBe(false);
      await vi.advanceTimersByTimeAsync(10000);
      expect(load2).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
