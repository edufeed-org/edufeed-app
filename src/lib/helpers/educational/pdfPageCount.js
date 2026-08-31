/**
 * Client-side page-count lookup for a linked PDF (#57).
 *
 * Deduplicated and memoised per URL, because a feed renders many cards and the
 * same file can appear on several of them. A URL that fails resolves to null and
 * is *remembered* as null: a card must not retry a 404 or a rights refusal on
 * every hover.
 *
 * Callers should only reach this when `canDeriveThumbnail` allows it — see
 * `pdfThumbnailGate.js`. The endpoint enforces its own technical guardrails
 * regardless.
 */

import { pdfInfoEndpoint } from './pdfThumbnailGate.js';

/** @type {Map<string, number | null>} */
const resolved = new Map();

/** @type {Map<string, Promise<number | null>>} */
const inflight = new Map();

/**
 * Page count for a PDF URL, or null when it is not knowable.
 *
 * @param {string} pdfUrl
 * @returns {Promise<number | null>}
 */
export async function loadPdfPageCount(pdfUrl) {
  if (!pdfUrl) return null;
  const cached = resolved.get(pdfUrl);
  if (cached !== undefined) return cached;

  const pending = inflight.get(pdfUrl);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(pdfInfoEndpoint(pdfUrl));
      if (!response.ok) return null;
      const data = await response.json();
      return Number.isInteger(data?.numPages) && data.numPages > 0 ? data.numPages : null;
    } catch {
      // Offline, aborted, or a non-JSON body — the badge simply omits the count.
      return null;
    }
  })().then((count) => {
    resolved.set(pdfUrl, count);
    inflight.delete(pdfUrl);
    return count;
  });

  inflight.set(pdfUrl, request);
  return request;
}

/**
 * Drop the memo. Exported for tests, which would otherwise leak a resolved
 * count from one case into the next.
 */
export function clearPdfPageCountCache() {
  resolved.clear();
  inflight.clear();
}
