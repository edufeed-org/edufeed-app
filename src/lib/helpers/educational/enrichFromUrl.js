/**
 * Tiny client-side wrapper around POST /api/enrich. Pure (fetch is injected),
 * so it can be unit-tested without a browser. Always resolves — never throws.
 * Returns `null` on any failure so callers can fall back gracefully.
 *
 * @typedef {import('./applyEnrichedPayload.js').ExtractMetadataResult | null} EnrichResult
 */

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @param {string} url
 * @param {'amb' | 'ekw'} variant
 * @param {{fetchFn?: typeof fetch, timeoutMs?: number}} [options]
 * @returns {Promise<EnrichResult>}
 */
export async function enrichFromUrl(url, variant, options = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn('/api/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, variant }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    return /** @type {EnrichResult} */ (await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
