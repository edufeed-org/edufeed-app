/**
 * The one JS breakpoint helper: Tailwind's `lg` (1024px), the line between
 * the phone chrome (dock, section button) and the desktop chrome (sidebars).
 *
 * Markup that merely differs switches with `lg:` classes. This helper is for
 * the two places where the DATA differs — the dashboard root rendering the
 * feed on phones and the Communities page mounting its own list — so one
 * branch of a page is mounted, never both (hidden twins still run effects
 * and click handlers; see src/routes/c/+layout.svelte).
 *
 * One `MediaQuery` is shared by every caller; without a window (SSR, node
 * tests) the getter reports desktop so nothing phone-specific renders
 * server-side.
 */
import { MediaQuery } from 'svelte/reactivity';

/** @type {MediaQuery | null} */
let query = null;

/**
 * @returns {() => boolean} reactive getter, true at `lg` and above
 */
export function useIsDesktop() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => true;
  }
  if (!query) query = new MediaQuery('(min-width: 1024px)');
  const q = query;
  return () => q.current;
}
