/**
 * Which dashboard view `/c/` renders for a `?view=` value.
 *
 * On phones (below lg) the root is the feed: the dock's first tab is Feed,
 * and the greeting + inbox card of the desktop "home" view would only push
 * the feed below the fold (mobile nav round 2). Desktop keeps "home".
 *
 * @param {string | null} viewParam - raw `?view=` value
 * @param {boolean} isDesktop - `useIsDesktop()` at render time
 * @returns {'home' | 'feed' | 'my-stuff' | 'communities' | string}
 */
export function resolveDashboardView(viewParam, isDesktop) {
  const view = viewParam || 'home';
  // Backward compat: old 'your-content' URL maps to 'my-stuff'
  if (view === 'your-content') return 'my-stuff';
  if (view === 'home' && !isDesktop) return 'feed';
  return view;
}
