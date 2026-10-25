import { sequence } from '@sveltejs/kit/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { ogMetaHandle } from '$lib/server/og.js';
import { preloadLinksHandle } from '$lib/server/link-header.js';
import { geoStatsHandle } from '$lib/server/geo/crawler-stats.js';

/** @type {import('@sveltejs/kit').Handle} */
const paraglideHandle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;
    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%lang%', locale)
    });
  });

// geoStatsHandle first: it counts the final response (status, size).
export const handle = sequence(geoStatsHandle, preloadLinksHandle, ogMetaHandle, paraglideHandle);
