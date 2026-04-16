import { resolve } from '$app/paths';

const resolvedBase = resolve('/c/');
const resolvedInbox = resolve('/c/inbox');
const resolvedMessages = resolve('/c/messages');

/**
 * Derive the active section for DashboardNavSidebar / DashboardBottomTabBar.
 *
 * @param {string} pathname - Current URL pathname
 * @param {URLSearchParams} searchParams - Current URL search params
 * @returns {'feed' | 'inbox' | 'messages' | 'my-stuff' | 'communities' | null}
 */
export function getDashboardActiveSection(pathname, searchParams) {
  if (!pathname.startsWith(resolvedBase)) return null;
  if (pathname.startsWith(resolvedMessages)) return 'messages';
  if (pathname === resolvedInbox || pathname === resolvedInbox + '/') return 'inbox';
  const view = searchParams.get('view') || 'feed';
  // Backward compat: old 'your-content' URL maps to 'my-stuff'
  if (view === 'your-content') return 'my-stuff';
  return /** @type {'feed' | 'my-stuff' | 'communities'} */ (view);
}
