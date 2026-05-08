import { fetchEventById } from '$lib/helpers/nostrUtils';
import { getCalendarEventMetadata } from '$lib/helpers/eventUtils';
import { initializeConfig } from '$lib/stores/config.svelte.js';
import { error } from '@sveltejs/kit';

export const ssr = false;
export const prerender = false;

/** @type {import('./$types').PageLoad} */
export async function load({ params, parent }) {
  const parentData = await parent();
  if (parentData.config) {
    initializeConfig(parentData.config);
  }

  const rawEvent = await fetchEventById(params.naddr);
  if (!rawEvent) {
    throw error(404, 'Event not found');
  }
  const event = getCalendarEventMetadata(rawEvent);

  return {
    event,
    rawEvent,
    naddr: params.naddr,
    contentView: 'calendar'
  };
}
