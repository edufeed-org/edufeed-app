import { fetchEventById } from '$lib/helpers/nostrUtils';
import { getCalendarEventMetadata } from '$lib/helpers/eventUtils';
import { initializeConfig } from '$lib/stores/config.svelte.js';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export async function load({ params, parent }) {
  // Ensure runtime config is initialized before fetching.
  // Config is normally initialized in +layout.svelte (after all load functions),
  // but on a cold/direct load (shared link, address bar) we need it here for
  // relay resolution — otherwise hint-less naddrs can never resolve.
  const parentData = await parent();
  if (parentData.config) {
    initializeConfig(parentData.config);
  }

  const rawEvent = await fetchEventById(params.naddr);
  const event = rawEvent ? getCalendarEventMetadata(rawEvent) : null;

  return {
    event,
    rawEvent, // Include raw event for AddToCalendarDropdown and editing
    naddr: params.naddr
  };
}
