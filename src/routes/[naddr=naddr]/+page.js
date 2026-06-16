import { nip19 } from 'nostr-tools';
import { fetchEventById } from '$lib/helpers/nostrUtils';
import { initializeConfig } from '$lib/stores/config.svelte.js';
import { getCanonicalEventRoute } from '$lib/helpers/eventRouteRedirect.js';
import { extractEventRefFromBookmark } from '$lib/helpers/urlGrouping.js';
import { error, redirect } from '@sveltejs/kit';

export const ssr = false;
export const prerender = false;

/**
 * @param {{ params: { naddr: string }, parent: () => Promise<any> }} context
 */
export async function load({ params, parent }) {
  // Ensure runtime config is initialized before fetching.
  // Config is normally initialized in +layout.svelte (after all load functions),
  // but we need it here for relay resolution. The guard prevents double-init.
  const parentData = await parent();
  if (parentData.config) {
    initializeConfig(parentData.config);
  }
  try {
    // Decode the naddr parameter
    const decoded = nip19.decode(params.naddr);

    // Validate it's an address pointer (type is 'naddr' for address pointers)
    if (decoded.type !== 'naddr') {
      throw error(400, 'Invalid address format - expected naddr');
    }

    // Fetch the event so we can route by both kind and h-tag.
    const event = await fetchEventById(params.naddr);
    if (!event) {
      throw error(404, 'Event not found');
    }

    // Special case: meet rooms route to community meet view with query params.
    if (event.kind === 30312 || event.kind === 30313) {
      const communityPubkey = event.tags?.find((t) => t[0] === 'h')?.[1];
      if (communityPubkey) {
        const npub = nip19.npubEncode(communityPubkey);
        redirect(307, `/c/${npub}?view=meet&room=${params.naddr}`);
      }
    }

    // Event-ref bookmarks (kind 39701 targeting a Nostr addressable event) render
    // the referenced event natively inside the unified social-bookmark detail
    // view. Redirect to that view, keyed by the target event coordinate.
    if (event.kind === 39701) {
      const pointer = extractEventRefFromBookmark(event);
      const communityHtag = event.tags?.find((t) => t[0] === 'h')?.[1];
      if (pointer) {
        const coordinate = encodeURIComponent(
          `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`
        );
        if (communityHtag) {
          const npub = nip19.npubEncode(communityHtag);
          redirect(307, `/c/${npub}/bookmarks/${coordinate}`);
        }
        redirect(307, `/bookmarks/${coordinate}`);
      }

      // Web-URL bookmark (no event-ref): redirect to the URL hub so it gets the
      // full social context (savers, highlights, reactions, comments) instead of
      // the bare reader.
      const rTag = event.tags?.find((t) => t[0] === 'r')?.[1];
      const dTag = event.tags?.find((t) => t[0] === 'd')?.[1];
      const url = rTag || (dTag ? `https://${dTag}` : null);
      if (url) {
        const encodedUrl = encodeURIComponent(url);
        if (communityHtag) {
          const npub = nip19.npubEncode(communityHtag);
          redirect(307, `/c/${npub}/bookmarks/${encodedUrl}`);
        }
        redirect(307, `/bookmarks/${encodedUrl}`);
      }
    }

    // Redirect to canonical route when this isn't it (calendar events,
    // community-scoped articles/resources/boards/wikis, etc.).
    const canonical = getCanonicalEventRoute(event);
    const currentPath = `/${params.naddr}`;
    if (canonical && canonical !== currentPath) {
      redirect(307, canonical);
    }

    return {
      naddr: params.naddr,
      decoded: decoded.data,
      event,
      kind: decoded.data.kind || event.kind
    };
  } catch (err) {
    // If it's already a SvelteKit error or redirect, re-throw it
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }

    console.error('Error loading naddr route:', err);

    // Otherwise, create a generic error
    throw error(500, 'Failed to load content');
  }
}
