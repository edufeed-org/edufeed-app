import { decodeEventPointer } from 'applesauce-core/helpers';
import { error } from '@sveltejs/kit';

export const ssr = false;
export const prerender = false;

/**
 * Dashboard nevent route: validates the identifier and returns immediately.
 * Event fetching and thread context are handled reactively in the component.
 * @type {import('./$types').PageLoad}
 */
export async function load({ params }) {
  const pointer = decodeEventPointer(params.nevent);
  if (!pointer) {
    throw error(400, 'Invalid nevent format');
  }

  return { nevent: params.nevent };
}
