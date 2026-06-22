/**
 * Pure multi-source fan-out for OER search. The homelab proxy queries ONE
 * source per request, so we issue one request per requested source in
 * parallel, merge + dedupe by `amb.id`, and aggregate `hasMore`. A single
 * source failing (rejection or non-ok) is logged and omitted — it never fails
 * the whole search. A source can also report a non-fatal `warning` in its meta
 * (e.g. rate-limited); those are aggregated so the UI can tell the difference
 * between "no matches" and "this source was unavailable". `fetch` is injected
 * so this unit-tests with no network.
 *
 * @typedef {{ id?: string, amb?: { id?: string } }} OerItem
 * @typedef {{ source: string, code: string }} OerSourceWarning
 *
 * @param {object} params
 * @param {string} params.baseUrl - homelab proxy base URL (no trailing path).
 * @param {string} params.searchTerm
 * @param {string[]} params.sources - already-validated source IDs.
 * @param {string} params.type - locked to 'image' by the caller.
 * @param {number} params.page
 * @param {number} params.pageSize
 * @param {string} [params.language]
 * @param {typeof fetch} params.fetchImpl
 * @returns {Promise<{ data: OerItem[], meta: { hasMore: boolean, warnings?: OerSourceWarning[] } }>}
 */
export async function fanOutOerSearch({
  baseUrl,
  searchTerm,
  sources,
  type,
  page,
  pageSize,
  language,
  fetchImpl
}) {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const u = new URL('/api/v1/oer', baseUrl);
      u.searchParams.set('source', source);
      u.searchParams.set('searchTerm', searchTerm);
      u.searchParams.set('type', type);
      u.searchParams.set('page', String(page));
      u.searchParams.set('pageSize', String(pageSize));
      if (language) u.searchParams.set('language', language);

      const res = await fetchImpl(u.toString());
      if (!res.ok) throw new Error(`source ${source} returned HTTP ${res.status}`);
      return /** @type {{ data?: OerItem[], meta?: { hasMore?: boolean, warnings?: OerSourceWarning[] } }} */ (
        await res.json()
      );
    })
  );

  /** @type {OerItem[]} */
  const data = [];
  const seen = new Set();
  let hasMore = false;
  /** @type {OerSourceWarning[]} */
  const warnings = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      console.error(`[oerFanout] source ${sources[i]} failed:`, r.reason);
      continue;
    }
    const body = r.value ?? {};
    if (body.meta?.hasMore) hasMore = true;
    for (const warning of body.meta?.warnings ?? []) warnings.push(warning);
    for (const oerItem of body.data ?? []) {
      const key = oerItem?.amb?.id ?? oerItem?.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      data.push(oerItem);
    }
  }

  return { data, meta: { hasMore, ...(warnings.length ? { warnings } : {}) } };
}
