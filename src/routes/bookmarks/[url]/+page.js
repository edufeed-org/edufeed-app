import { redirect } from '@sveltejs/kit';
import { parseBookmarkUrlParam, getInternalBookmarkRedirectTarget } from '$lib/helpers/bookmark.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export async function load({ params }) {
  // Event-ref bookmarks (Nostr coordinate, not a web URL) render the referenced
  // event natively within the unified social-bookmark detail view.
  const eventRef = parseBookmarkUrlParam(params.url);

  // Self-referential bookmark: the param is itself an edufeed bookmark page.
  // Unwrap to the real article and redirect to its canonical page.
  const innerUrl = getInternalBookmarkRedirectTarget(params.url);
  if (innerUrl) {
    redirect(307, `/bookmarks/${encodeURIComponent(innerUrl)}`);
  }

  return {
    encodedUrl: params.url,
    eventRef
  };
}
