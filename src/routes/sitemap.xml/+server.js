import { env } from '$env/dynamic/private';
import { buildSitemapXml, createSitemapCache } from '$lib/server/geo/sitemap.js';

const cache = createSitemapCache({ ttlMs: 6 * 60 * 60 * 1000 });

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
  try {
    const xml = await cache.get(url.origin, () => buildSitemapXml(url.origin, env));
    return new Response(xml, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600'
      }
    });
  } catch {
    // First build failed (no cached sitemap yet): tell crawlers to come back.
    return new Response('Sitemap temporarily unavailable', {
      status: 503,
      headers: { 'retry-after': '600' }
    });
  }
}
