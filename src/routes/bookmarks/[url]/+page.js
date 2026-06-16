import { redirect } from '@sveltejs/kit';
import { getBookmarkEventRefRedirect } from '$lib/helpers/bookmark.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export async function load({ params }) {
  // Event-ref bookmarks (Nostr coordinate, not a web URL) render the referenced
  // event, so redirect to its naddr instead of the web-reader detail page.
  const target = getBookmarkEventRefRedirect(params.url);
  if (target) redirect(307, target);

  return {
    encodedUrl: params.url
  };
}
