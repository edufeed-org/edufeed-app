import { env } from '$env/dynamic/private';
import { isSearchIndexingEnabled } from '$lib/server/geo/indexability.js';

/** @type {import('./$types').RequestHandler} */
export function GET({ url }) {
  // Allow everything (as the former static/robots.txt did) and point crawlers
  // at the sitemap of whichever origin serves this deployment.
  const body = isSearchIndexingEnabled(env)
    ? `User-agent: *\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n`
    : // Staging (SEARCH_INDEXING=false): keep the deployment out of search indexes.
      'User-agent: *\nDisallow: /\n';
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
}
