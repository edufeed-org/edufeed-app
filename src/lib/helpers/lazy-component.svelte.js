import { browser } from '$app/environment';

/**
 * @template T
 * @typedef {() => Promise<{ default: T }>} ComponentLoader
 */

/**
 * Defer a component's `import()` until the first read of `.Component`.
 *
 * Root-layout chrome (ModalManager's modals, the per-surface sidebars, Termi)
 * used to be static imports, so every first visit preloaded their whole
 * dependency graph — ~290 chunks / 2.7MB for the landing page. Wrapping a
 * component in `lazyComponent(() => import('./X.svelte'))` keeps it a
 * separate chunk that only loads once a template actually reads it.
 *
 * `.Component` is reactive: it is `null` until the module resolves, then the
 * default export. The loader runs once (a rejected import may be retried on a
 * later read, so a transient network failure is not permanent), and never on
 * the server — SSR renders the pending (null) state.
 *
 * @template T
 * @param {ComponentLoader<T>} load
 * @returns {{ readonly Component: T | null }}
 */
export function lazyComponent(load) {
  let component = $state.raw(/** @type {T | null} */ (null));
  let loading = false;

  return {
    get Component() {
      if (!component && !loading && browser) {
        loading = true;
        load().then(
          (mod) => {
            component = mod.default;
          },
          (err) => {
            loading = false;
            console.error('Lazy component failed to load:', err);
          }
        );
      }
      return component;
    }
  };
}
