import { decodeEventPointer } from 'applesauce-core/helpers';
import { initializeConfig } from '$lib/stores/config.svelte.js';
import { error } from '@sveltejs/kit';

export const ssr = false;
export const prerender = false;

/**
 * Top-level nevent route: validates the identifier and returns immediately.
 * Event fetching, thread context, and redirects are handled reactively in the component.
 * @param {{ params: { nevent: string }, parent: () => Promise<any> }} context
 */
export async function load({ params, parent }) {
  const pointer = decodeEventPointer(params.nevent);
  if (!pointer) {
    throw error(400, 'Invalid nevent format');
  }

  // Ensure runtime config is initialized (needed for relay resolution in component)
  const parentData = await parent();
  if (parentData.config) {
    initializeConfig(parentData.config);
  }

  return { nevent: params.nevent };
}
