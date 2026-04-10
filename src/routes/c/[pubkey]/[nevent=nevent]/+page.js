import { decodeEventPointer } from 'applesauce-core/helpers';
import { fetchEventById } from '$lib/helpers/nostrUtils.js';
import { resolveThreadContext } from '$lib/helpers/threadContext.js';
import { error } from '@sveltejs/kit';

export const ssr = false;
export const prerender = false;

/**
 * @type {import('./$types').PageLoad}
 */
export async function load({ params }) {
  const pointer = decodeEventPointer(params.nevent);
  if (!pointer) {
    throw error(400, 'Invalid nevent format');
  }

  const event = await fetchEventById(params.nevent);
  if (!event) {
    throw error(404, 'Event not found');
  }

  const context = await resolveThreadContext(event, fetchEventById);

  return {
    event: context.event,
    parentPointer: context.parentPointer ?? null,
    focusCommentId: context.focusCommentId ?? null,
    scrollTo: context.scrollTo ?? null,
    nevent: params.nevent
  };
}
