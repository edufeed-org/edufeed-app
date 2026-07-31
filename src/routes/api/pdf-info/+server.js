/**
 * App-side PDF page-count endpoint (issue #57).
 *
 * A resource card's hover badge says what is behind the card — "PDF · 12
 * Seiten · 2,4 MB". Type and size come off the Nostr event; AMB's `encoding:*`
 * has no page count, so it has to be read from the file.
 *
 * Cheap in the common case: `/api/pdf-thumbnail` already parses the document to
 * render the cover and writes `numPages` to a sidecar, so a card that shows a
 * PDF cover answers from disk. The fetch-and-parse path below is only for files
 * no thumbnail was ever rendered for, and it skips canvas and sharp entirely.
 *
 * Same rights model as the thumbnail: whether the app may derive anything from
 * this file is decided client-side by `pdfThumbnailGate.js`. Guardrails are
 * shared via `$lib/server/pdfSource.js` — deliberately not reimplemented here,
 * which is the mistake #31 fixed in `/api/reader`.
 */

import { readFile } from 'node:fs/promises';
import { parseHttpUrl, isBlockedHost } from '$lib/server/httpUrl.js';
import { readPdfPageCount } from '$lib/server/pdfThumbnail.js';
import { fetchPdfBytes, pdfCachePath, writePdfCache } from '$lib/server/pdfSource.js';

/** A given URL's page count does not change; cache it as long as thumbnails. */
const CACHE_CONTROL = 'public, max-age=86400, immutable';

/** @param {number} numPages */
function pageCountResponse(numPages) {
  return new Response(JSON.stringify({ numPages }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': CACHE_CONTROL }
  });
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
  const pdfUrl = url.searchParams.get('url');
  if (!pdfUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }

  const parsed = parseHttpUrl(pdfUrl);
  if (!parsed) {
    return new Response('URL must be a valid http or https URL', { status: 400 });
  }
  if (await isBlockedHost(parsed)) {
    return new Response('Private/local URLs are not allowed', { status: 400 });
  }

  const canonicalUrl = parsed.toString();
  const file = pdfCachePath(canonicalUrl, 'pages.json');

  // Sidecar hit — usually written by the thumbnail render for this same file.
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    if (Number.isInteger(cached?.numPages) && cached.numPages > 0) {
      return pageCountResponse(cached.numPages);
    }
    // A corrupt or truncated sidecar must not be served as a page count; fall
    // through and re-derive it.
  } catch {
    // miss — derive below
  }

  const source = await fetchPdfBytes(canonicalUrl);
  if (!source.ok) return source.response;

  /** @type {number} */
  let numPages;
  try {
    numPages = await readPdfPageCount(source.bytes);
  } catch (err) {
    console.warn('[/api/pdf-info] parse failed:', /** @type {any} */ (err)?.message);
    return new Response('Failed to read PDF', { status: 502 });
  }

  if (!Number.isInteger(numPages) || numPages < 1) {
    return new Response('Failed to read PDF', { status: 502 });
  }

  await writePdfCache(file, JSON.stringify({ numPages }), '/api/pdf-info');
  return pageCountResponse(numPages);
}
