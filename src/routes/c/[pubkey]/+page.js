import { VALID_CONTENT_VIEWS } from '$lib/helpers/contentTypes.js';

/**
 * Community home page load function.
 * Layout already validates npub → hex pubkey.
 * This just passes the ?view= param as contentView.
 * @type {import('./$types').PageLoad}
 */
export async function load({ url }) {
  const viewParam = url.searchParams.get('view');
  const contentView = viewParam && VALID_CONTENT_VIEWS.has(viewParam) ? viewParam : undefined;

  return { contentView };
}
