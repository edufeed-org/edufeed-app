/**
 * "A new version was deployed" signal for the root layout.
 *
 * SvelteKit polls /_app/version.json (kit.version.pollInterval in
 * svelte.config.js) and flips `updated.current` once the deployed
 * `kit.version.name` differs from the one this page was built with. Tabs that
 * stay open across deploys otherwise keep running stale code for days.
 *
 * `$app/state` is import-safe during SSR (every getter is a plain false /
 * null there), so no browser guard is needed around the import; the value
 * only ever becomes true in the browser.
 */
import { updated } from '$app/state';

/**
 * @returns {{ updateAvailable: boolean, check: () => Promise<boolean> }}
 *   `updateAvailable` is reactive (read it inside an $effect / $derived);
 *   `check()` forces one poll now instead of waiting for the interval.
 */
export function getAppUpdateState() {
  return {
    get updateAvailable() {
      return updated.current;
    },
    check: () => updated.check()
  };
}
