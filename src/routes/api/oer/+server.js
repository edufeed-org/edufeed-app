/**
 * OER search proxy with server-side multi-source fan-out.
 *
 * Thin route over the homelab `oer-finder-plugin` proxy (`OER_PROXY_URL`).
 * The proxy queries one source per request, so this route fans out one upstream
 * request per requested source (validated against the app's source allowlist),
 * merges + dedupes, and returns `{ data, meta: { hasMore } }`. `type` is locked
 * to `image` — this picker only places cover images. Mirrors /api/enrich's
 * 503-when-unconfigured contract.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { fanOutOerSearch } from '$lib/server/oerFanout.js';
import { parseRequestedSources } from '$lib/config/oer-sources.js';

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
  const baseUrl = env.OER_PROXY_URL;
  if (!baseUrl) {
    console.error('[/api/oer] OER_PROXY_URL is not configured');
    return json({ error: 'OER search not configured' }, { status: 503 });
  }

  const searchTerm = url.searchParams.get('searchTerm')?.trim();
  if (!searchTerm) {
    return json({ error: 'Missing searchTerm' }, { status: 400 });
  }

  const sources = parseRequestedSources(url.searchParams.get('sources'));
  const page = Math.max(parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1);
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? '', 10);
  const pageSize = Math.min(
    Math.max(Number.isNaN(pageSizeRaw) ? DEFAULT_PAGE_SIZE : pageSizeRaw, 1),
    MAX_PAGE_SIZE
  );
  const langRaw = url.searchParams.get('language');
  const language = langRaw === 'en' || langRaw === 'de' ? langRaw : undefined;

  try {
    const result = await fanOutOerSearch({
      baseUrl,
      searchTerm,
      sources,
      type: 'image',
      page,
      pageSize,
      language,
      fetchImpl: fetch
    });
    return json(result, { status: 200 });
  } catch (err) {
    console.error('[/api/oer] fan-out failed:', err);
    return json({ error: 'OER search upstream failed' }, { status: 502 });
  }
}
