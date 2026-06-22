/**
 * Browser-side wrappers over the OER server routes. `fetch` is injected
 * (defaults to global) so these unit-test without a running server.
 */

/**
 * Query `/api/oer` for image search hits across the given sources.
 * @param {{ searchTerm: string, sources: string[], page?: number, pageSize?: number, language?: 'en' | 'de' }} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ data: any[], meta: { hasMore: boolean, warnings?: Array<{ source: string, code: string }> } }>}
 */
export async function searchOer(
  { searchTerm, sources, page = 1, pageSize, language },
  fetchImpl = fetch
) {
  const u = new URL('/api/oer', 'http://localhost');
  u.searchParams.set('searchTerm', searchTerm);
  u.searchParams.set('sources', sources.join(','));
  u.searchParams.set('page', String(page));
  if (pageSize) u.searchParams.set('pageSize', String(pageSize));
  if (language) u.searchParams.set('language', language);

  const res = await fetchImpl(u.pathname + u.search);
  if (!res.ok) throw new Error(`OER search failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Resolve `{ sha256, mime, size }` for an original image URL via /api/oer/asset.
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ sha256: string, mime: string, size: number }>}
 */
export async function fetchOerAsset(url, fetchImpl = fetch) {
  const u = new URL('/api/oer/asset', 'http://localhost');
  u.searchParams.set('url', url);
  const res = await fetchImpl(u.pathname + u.search);
  if (!res.ok) throw new Error(`OER asset hash failed: HTTP ${res.status}`);
  return res.json();
}
