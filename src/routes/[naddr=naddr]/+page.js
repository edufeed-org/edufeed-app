import { nip19 } from 'nostr-tools';
import { fetchEventById } from '$lib/helpers/nostrUtils';
import { initializeConfig } from '$lib/stores/config.svelte.js';
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

    // Redirect calendar events to their dedicated detail pages
    const kind = decoded.data.kind;
    if (kind === 31922 || kind === 31923) {
      redirect(307, `/calendar/event/${params.naddr}`);
    }
    if (kind === 31924) {
      redirect(307, `/calendar/${params.naddr}`);
    }

    // Redirect meet room events to community meet view
    if (kind === 30312 || kind === 30313) {
      const roomEvent = await fetchEventById(params.naddr);
      const communityPubkey = roomEvent?.tags?.find((t) => t[0] === 'h')?.[1];
      if (communityPubkey) {
        const npub = nip19.npubEncode(communityPubkey);
        redirect(307, `/c/${npub}?view=meet&room=${params.naddr}`);
      }
    }

    // Fetch the actual event
    const event = await fetchEventById(params.naddr);

    if (!event) {
      throw error(404, 'Event not found');
    }

    return {
      naddr: params.naddr,
      decoded: decoded.data,
      event,
      kind: kind || event.kind
    };
  } catch (err) {
    console.error('Error loading naddr route:', err);

    // If it's already a SvelteKit error, re-throw it
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }

    // Otherwise, create a generic error
    throw error(500, 'Failed to load content');
  }
}
