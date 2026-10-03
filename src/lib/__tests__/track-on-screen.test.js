/** @vitest-environment node */
/**
 * trackOnScreen — the bookkeeping behind the call store's stage counter
 * (registerCallStageView): registers while the node has layout, unregisters
 * at 0×0 (hidden via display:none, e.g. the mobile "‹ Kanäle" collapse) and
 * re-registers once it is visible again. Without a ResizeObserver (SSR-ish
 * environments) it simply counts as on screen for as long as it is tracked.
 */
import { describe, it, expect, vi } from 'vitest';
import { trackOnScreen } from '$lib/groups/track-on-screen.js';

/** A minimal ResizeObserver stub that lets a test fire resize entries by hand. */
function makeFakeResizeObserver() {
  /** @type {{ cb: (entries: any[]) => void, observed: any[], disconnected: boolean } | undefined} */
  let instance;
  class FakeResizeObserver {
    /** @param {(entries: any[]) => void} cb */
    constructor(cb) {
      instance = { cb, observed: [], disconnected: false };
      this._instance = instance;
    }
    /** @param {any} node */
    observe(node) {
      this._instance.observed.push(node);
    }
    disconnect() {
      this._instance.disconnected = true;
    }
  }
  return {
    FakeResizeObserver,
    getInstance: () => /** @type {NonNullable<typeof instance>} */ (instance)
  };
}

/** A counter-backed register/unregister pair, like the call store's real one. */
function makeCounter() {
  let count = 0;
  return {
    register: () => {
      count++;
      return () => {
        count--;
      };
    },
    get count() {
      return count;
    }
  };
}

describe('trackOnScreen', () => {
  it('registers immediately on start and observes the node', () => {
    const { FakeResizeObserver, getInstance } = makeFakeResizeObserver();
    const node = /** @type {any} */ ({
      ownerDocument: { defaultView: { ResizeObserver: FakeResizeObserver } }
    });
    const register = vi.fn(() => vi.fn());

    const stop = trackOnScreen(node, register);

    expect(register).toHaveBeenCalledTimes(1);
    expect(getInstance().observed).toEqual([node]);
    stop();
  });

  it('unregisters at 0×0 and re-registers exactly once when visible again', () => {
    const { FakeResizeObserver, getInstance } = makeFakeResizeObserver();
    const node = /** @type {any} */ ({
      ownerDocument: { defaultView: { ResizeObserver: FakeResizeObserver } }
    });
    const counter = makeCounter();

    const stop = trackOnScreen(node, counter.register);
    expect(counter.count).toBe(1);

    const fire = (/** @type {{width: number, height: number}} */ box) =>
      getInstance().cb([{ contentRect: box }]);

    fire({ width: 0, height: 0 });
    expect(counter.count).toBe(0);

    // Still hidden: must not unregister a second time (off is already null).
    fire({ width: 0, height: 0 });
    expect(counter.count).toBe(0);

    fire({ width: 300, height: 200 });
    expect(counter.count).toBe(1);

    // Still visible: must not re-register a second time.
    fire({ width: 320, height: 240 });
    expect(counter.count).toBe(1);

    stop();
    expect(counter.count).toBe(0);
  });

  it('stop always releases and disconnects, whatever the last-seen size was', () => {
    const { FakeResizeObserver, getInstance } = makeFakeResizeObserver();
    const node = /** @type {any} */ ({
      ownerDocument: { defaultView: { ResizeObserver: FakeResizeObserver } }
    });
    const counter = makeCounter();

    // Stopped right after start (never resized, still registered from the
    // constructor's synchronous register() call).
    const stopImmediately = trackOnScreen(node, counter.register);
    expect(counter.count).toBe(1);
    stopImmediately();
    expect(counter.count).toBe(0);
    expect(getInstance().disconnected).toBe(true);

    // Stopped while hidden (already unregistered) — must not go negative.
    const stopWhileHidden = trackOnScreen(node, counter.register);
    expect(counter.count).toBe(1);
    getInstance().cb([{ contentRect: { width: 0, height: 0 } }]);
    expect(counter.count).toBe(0);
    stopWhileHidden();
    expect(counter.count).toBe(0);
  });

  it('without a ResizeObserver, counts as on screen for the life of the track', () => {
    const node = /** @type {any} */ ({ ownerDocument: { defaultView: {} } });
    const counter = makeCounter();

    const stop = trackOnScreen(node, counter.register);
    expect(counter.count).toBe(1);

    stop();
    expect(counter.count).toBe(0);
  });
});
