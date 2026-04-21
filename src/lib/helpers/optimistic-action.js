import { SvelteMap } from 'svelte/reactivity';

/**
 * Creates a reactive optimistic state container for async actions.
 * Query functions check `has(key)` / `get(key)` before falling back to real state.
 * Action functions call `run(key, value, asyncFn)` for instant UI feedback.
 *
 * @returns {{ has: (key: string) => boolean, get: (key: string) => any, isPending: (key: string) => boolean, run: (key: string, value: any, action: () => Promise<void>, opts?: { slowThreshold?: number, onSlow?: () => (() => void) | void }) => Promise<void> }}
 */
export function createOptimisticState() {
  const overrides = new SvelteMap();
  return {
    /** @param {string} key */
    has: (key) => overrides.has(key),
    /** @param {string} key */
    get: (key) => overrides.get(key),
    /** Whether an async action is in-flight for a key. @param {string} key */
    isPending: (key) => overrides.has(key),
    /**
     * Set an optimistic override, run the async action, then clear the override.
     * On success: eventStore holds the real state. On failure: old state restored.
     * If `slowThreshold` + `onSlow` are provided, `onSlow` fires when the action
     * takes longer than `slowThreshold` ms (e.g., to show "awaiting signer" toast).
     * @param {string} key
     * @param {any} value
     * @param {() => Promise<void>} action
     * @param {{ slowThreshold?: number, onSlow?: () => (() => void) | void }} [opts]
     */
    async run(key, value, action, opts) {
      overrides.set(key, value);
      /** @type {{ dismiss?: () => void }} */
      const slow = {};
      const onSlow = opts?.onSlow;
      const timer =
        opts?.slowThreshold && onSlow
          ? setTimeout(() => {
              const result = onSlow();
              if (result) slow.dismiss = result;
            }, opts.slowThreshold)
          : undefined;
      try {
        await action();
      } finally {
        if (timer) clearTimeout(timer);
        if (slow.dismiss) slow.dismiss();
        overrides.delete(key);
      }
    }
  };
}
