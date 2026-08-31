import { resolve } from '$app/paths';

/**
 * Strip a single trailing slash (except when the path is exactly '/').
 *
 * Needed because SvelteKit's default `trailingSlash: 'never'` normalizes the
 * URL to `/c` on server loads, while client-side links still produce `/c/`
 * briefly — comparisons must be slash-agnostic.
 *
 * @param {string} path
 */
function stripTrailingSlash(path) {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

const resolvedBase = stripTrailingSlash(resolve('/c/'));
const resolvedInbox = stripTrailingSlash(resolve('/c/inbox'));
const resolvedMessages = stripTrailingSlash(resolve('/c/messages'));
const resolvedGroups = stripTrailingSlash(resolve('/c/groups'));

/**
 * Derive the active section for DashboardNavSidebar / DashboardBottomTabBar.
 *
 * @param {string} pathname - Current URL pathname
 * @param {URLSearchParams} searchParams - Current URL search params
 * @returns {'home' | 'feed' | 'inbox' | 'messages' | 'groups' | 'my-stuff' | 'communities' | null}
 */
export function getDashboardActiveSection(pathname, searchParams) {
  const normalized = stripTrailingSlash(pathname);
  if (normalized !== resolvedBase && !normalized.startsWith(resolvedBase + '/')) return null;
  if (normalized === resolvedMessages || normalized.startsWith(resolvedMessages + '/'))
    return 'messages';
  if (normalized === resolvedGroups || normalized.startsWith(resolvedGroups + '/')) return 'groups';
  if (normalized === resolvedInbox) return 'inbox';
  const view = searchParams.get('view') || 'home';
  // Backward compat: old 'your-content' URL maps to 'my-stuff'
  if (view === 'your-content') return 'my-stuff';
  return /** @type {'home' | 'feed' | 'my-stuff' | 'communities'} */ (view);
}
