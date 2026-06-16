import { redirect } from '@sveltejs/kit';
import {
  getBookmarkEventRefRedirect,
  getInternalBookmarkRedirectTarget
} from '$lib/helpers/bookmark.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export async function load({ params }) {
  // Event-ref bookmarks (Nostr coordinate, not a web URL) render the referenced
  // event, so redirect to its naddr instead of the web-reader detail page.
  const target = getBookmarkEventRefRedirect(params.url);
  if (target) redirect(307, target);

  // Self-referential bookmark: the param is itself an edufeed bookmark page.
  // Unwrap to the real article and redirect to this community's canonical page.
  const innerUrl = getInternalBookmarkRedirectTarget(params.url);
  if (innerUrl) {
    redirect(307, `/c/${params.pubkey}/bookmarks/${encodeURIComponent(innerUrl)}`);
  }

  return {
    encodedUrl: params.url,
    contentView: 'social-bookmarks'
  };
}
