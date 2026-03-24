import { fetchEventById } from '$lib/helpers/nostrUtils.js';
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

  const event = await fetchEventById(params.naddr);
  if (!event) {
    throw error(404, 'Article not found');
  }

  return {
    event,
    naddr: params.naddr,
    contentView: 'articles'
  };
}
