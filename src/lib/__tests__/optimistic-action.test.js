/**
 * Tests for the createOptimisticState() helper.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { createOptimisticState } from '$lib/helpers/optimistic-action.js';

describe('createOptimisticState', () => {
  it('has() returns false when no override is set', () => {
    const state = createOptimisticState();
    expect(state.has('key1')).toBe(false);
  });

  it('get() returns undefined when no override is set', () => {
    const state = createOptimisticState();
    expect(state.get('key1')).toBeUndefined();
  });

  it('has()/get() return override while action is pending', async () => {
    const state = createOptimisticState();
    let resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });

    const runPromise = state.run('key1', true, () => pending);

    expect(state.has('key1')).toBe(true);
    expect(state.get('key1')).toBe(true);

    resolve();
    await runPromise;
  });

  it('override is cleared after successful action', async () => {
    const state = createOptimisticState();

    await state.run('key1', true, async () => {});

    expect(state.has('key1')).toBe(false);
    expect(state.get('key1')).toBeUndefined();
  });

  it('override is cleared after failed action (rollback)', async () => {
    const state = createOptimisticState();

    await expect(
      state.run('key1', true, async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');

    expect(state.has('key1')).toBe(false);
    expect(state.get('key1')).toBeUndefined();
  });

  it('supports false as optimistic value', async () => {
    const state = createOptimisticState();
    let resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });

    const runPromise = state.run('key1', false, () => pending);

    expect(state.has('key1')).toBe(true);
    expect(state.get('key1')).toBe(false);

    resolve();
    await runPromise;
  });

  it('multiple concurrent keys work independently', async () => {
    const state = createOptimisticState();
    let resolve1, resolve2;
    const p1 = new Promise((r) => {
      resolve1 = r;
    });
    const p2 = new Promise((r) => {
      resolve2 = r;
    });

    const run1 = state.run('a', true, () => p1);
    const run2 = state.run('b', false, () => p2);

    expect(state.has('a')).toBe(true);
    expect(state.get('a')).toBe(true);
    expect(state.has('b')).toBe(true);
    expect(state.get('b')).toBe(false);

    // Resolve first, second still pending
    resolve1();
    await run1;
    expect(state.has('a')).toBe(false);
    expect(state.has('b')).toBe(true);

    resolve2();
    await run2;
    expect(state.has('b')).toBe(false);
  });

  it('isPending() returns true while action runs, false after', async () => {
    const state = createOptimisticState();
    let resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });

    const runPromise = state.run('key1', true, () => pending);

    expect(state.isPending('key1')).toBe(true);
    expect(state.isPending('other')).toBe(false);

    resolve();
    await runPromise;

    expect(state.isPending('key1')).toBe(false);
  });

  it('calls onSlow after slowThreshold when action is still pending', async () => {
    const state = createOptimisticState();
    let slowCalled = false;
    let resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });

    const runPromise = state.run('key1', true, () => pending, {
      slowThreshold: 50,
      onSlow: () => {
        slowCalled = true;
      }
    });

    expect(slowCalled).toBe(false);

    // Wait past the threshold
    await new Promise((r) => setTimeout(r, 80));
    expect(slowCalled).toBe(true);

    resolve();
    await runPromise;
  });

  it('does not call onSlow if action completes before threshold', async () => {
    const state = createOptimisticState();
    let slowCalled = false;

    await state.run('key1', true, async () => {}, {
      slowThreshold: 100,
      onSlow: () => {
        slowCalled = true;
      }
    });

    // Wait past the threshold to be sure
    await new Promise((r) => setTimeout(r, 150));
    expect(slowCalled).toBe(false);
  });

  it('calls cleanup returned by onSlow when action completes', async () => {
    const state = createOptimisticState();
    let cleanupCalled = false;
    let resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });

    const runPromise = state.run('key1', true, () => pending, {
      slowThreshold: 50,
      onSlow: () => {
        // Return a cleanup/dismiss function (like a persistent toast dismiss)
        return () => {
          cleanupCalled = true;
        };
      }
    });

    // Wait past the threshold so onSlow fires
    await new Promise((r) => setTimeout(r, 80));
    expect(cleanupCalled).toBe(false);

    // Complete the action — cleanup should be called
    resolve();
    await runPromise;
    expect(cleanupCalled).toBe(true);
  });

  it('does not fail if onSlow returns nothing', async () => {
    const state = createOptimisticState();
    let resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });

    const runPromise = state.run('key1', true, () => pending, {
      slowThreshold: 50,
      onSlow: () => {
        /* returns undefined */
      }
    });

    await new Promise((r) => setTimeout(r, 80));
    resolve();
    await runPromise; // Should not throw
  });
});
