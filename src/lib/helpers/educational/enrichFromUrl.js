/**
 * Tiny client-side wrapper around POST /api/enrich. Pure (fetch is injected),
 * so it can be unit-tested without a browser. Always resolves — never throws.
 *
 * Returns either:
 *  - an `ExtractMetadataResult` on success,
 *  - `{ error: 'ai_unavailable', code }` when the upstream extractor is
 *    unavailable (network failure, non-2xx, malformed body, or the server's
 *    own {error, code} envelope when extract_metadata failed in-flight).
 *
 * Callers should treat the error envelope as "show a 'try again' hint" and
 * leave the existing form values untouched.
 *
 * @typedef {import('./applyEnrichedPayload.js').ExtractMetadataResult} ExtractMetadataResult
 * @typedef {{ error: 'ai_unavailable', code: string }} EnrichError
 * @typedef {ExtractMetadataResult | EnrichError | null} EnrichResult
 */

const DEFAULT_TIMEOUT_MS = 60_000;

/** @returns {EnrichError} */
function networkError() {
  return { error: 'ai_unavailable', code: 'network' };
}

/**
 * @param {string} url
 * @param {'amb' | 'ekw' | 'konfi'} variant
 * @param {{fetchFn?: typeof fetch, timeoutMs?: number, bildungsbereich?: string}} [options]
 * @returns {Promise<EnrichResult>}
 */
export async function enrichFromUrl(url, variant, options = {}) {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  /** @type {{url: string, variant: string, bildungsbereich?: string}} */
  const body = { url, variant };
  if (options.bildungsbereich) body.bildungsbereich = options.bildungsbereich;

  try {
    const res = await fetchFn('/api/enrich', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) return networkError();
    try {
      return /** @type {EnrichResult} */ (await res.json());
    } catch {
      return networkError();
    }
  } catch {
    return networkError();
  } finally {
    clearTimeout(timer);
  }
}
