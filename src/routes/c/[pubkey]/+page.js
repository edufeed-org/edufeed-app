/**
 * Community home page load function.
 * Layout already validates npub → hex pubkey.
 * This just passes the ?view= param as contentView.
 * @type {import('./$types').PageLoad}
 */
export async function load({ url }) {
  const validContentTypes = new Set([
    'home',
    'chat',
    'calendar',
    'learning',
    'boards',
    'articles',
    'forum',
    'polls',
    'social-bookmarks',
    'meet',
    'settings'
  ]);

  const viewParam = url.searchParams.get('view');
  const contentView = viewParam && validContentTypes.has(viewParam) ? viewParam : undefined;

  return { contentView };
}
