import { parseBookmarkUrlParam } from '$lib/helpers/bookmark.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export async function load({ params }) {
  // Event-ref bookmarks (Nostr coordinate, not a web URL) render the referenced
  // event natively within the unified social-bookmark detail view.
  const eventRef = parseBookmarkUrlParam(params.url);

  return {
    encodedUrl: params.url,
    eventRef
  };
}
