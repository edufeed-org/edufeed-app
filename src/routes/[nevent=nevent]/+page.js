import {
  decodeEventPointer,
  getAddressPointerForEvent,
  encodePointer
} from 'applesauce-core/helpers';
import { fetchEventById, hexToNpub } from '$lib/helpers/nostrUtils.js';
import { resolveThreadContext } from '$lib/helpers/threadContext.js';
import { initializeConfig } from '$lib/stores/config.svelte.js';
import { error, redirect } from '@sveltejs/kit';

export const ssr = false;
export const prerender = false;

/**
 * Top-level nevent route: resolves meta-events first, then routes by community or content type.
 * @param {{ params: { nevent: string }, parent: () => Promise<any> }} context
 */
export async function load({ params, parent }) {
  const pointer = decodeEventPointer(params.nevent);
  if (!pointer) {
    throw error(400, 'Invalid nevent format');
  }

  // Ensure runtime config is initialized before fetching (needed for relay resolution)
  const parentData = await parent();
  if (parentData.config) {
    initializeConfig(parentData.config);
  }

  const event = await fetchEventById(params.nevent);
  if (!event) {
    throw error(404, 'Event not found');
  }

  // Resolve meta-events (reaction→target, comment→root, RSVP→calendar event) FIRST
  const context = await resolveThreadContext(event, fetchEventById);
  const resolvedEvent = context.event;

  // Route based on the resolved event
  const hTag = resolvedEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'h');

  if (!hTag?.[1]) {
    // Redirect addressable events (calendar, educational, etc.) to naddr route
    const addrPointer = getAddressPointerForEvent(resolvedEvent);
    if (addrPointer) {
      const naddr = encodePointer(addrPointer);
      if (naddr) {
        redirect(307, `/${naddr}`);
      }
    }
    // No community — render directly
    return {
      event: resolvedEvent,
      parentEvent: context.parentEvent ?? null,
      focusCommentId: context.focusCommentId ?? null,
      scrollTo: context.scrollTo ?? null,
      nevent: params.nevent
    };
  }

  const npub = hexToNpub(hTag[1]);
  if (!npub) {
    throw error(400, 'Invalid community pubkey in event');
  }

  redirect(307, `/c/${npub}/${params.nevent}`);
}
