/**
 * App-side PDF thumbnail endpoint (issue #24).
 *
 * Renders page 1 of a PDF to a ~400px WebP, cached on disk keyed by the URL
 * hash. Thumbnails are an app-level presentation concern — they are never
 * written onto the user's Nostr event; cards simply point an <img> here.
 * Whether a thumbnail is *allowed* (open license / attested upload) is
 * decided client-side by `pdfThumbnailGate.js`; the technical guardrails
 * (http(s) only, private-IP block via guarded redirects, size cap, timeout,
 * content-type check) live in `$lib/server/pdfSource.js` and are shared with
 * the other derived-artifact endpoints.
 *
 * Side effect worth knowing (#57): rendering also writes the page count to a
 * sidecar, because the document is already parsed here. `/api/pdf-info` reads
 * that sidecar, so a card whose cover already rendered gets its page count
 * without a second fetch of the file.
 */

import { readFile } from 'node:fs/promises';
import { parseHttpUrl, isBlockedHost } from '$lib/server/httpUrl.js';
import { renderPdfThumbnail } from '$lib/server/pdfThumbnail.js';
import { fetchPdfBytes, pdfCachePath, writePdfCache } from '$lib/server/pdfSource.js';

/** Browser + CDN may cache aggressively — thumbnails are immutable per URL. */
const CACHE_CONTROL = 'public, max-age=86400, immutable';

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

  // Cache hit → serve immediately
  const canonicalUrl = parsed.toString();
  const file = pdfCachePath(canonicalUrl, 'webp');
  try {
    const cached = await readFile(file);
    return new Response(new Uint8Array(cached), {
      status: 200,
      headers: { 'content-type': 'image/webp', 'cache-control': CACHE_CONTROL }
    });
  } catch {
    // miss — render below
  }

  const source = await fetchPdfBytes(canonicalUrl);
  if (!source.ok) return source.response;

  /** @type {{ webp: Buffer, numPages: number }} */
  let rendered;
  try {
    rendered = await renderPdfThumbnail(source.bytes);
  } catch (err) {
    console.warn('[/api/pdf-thumbnail] render failed:', /** @type {any} */ (err)?.message);
    return new Response('Failed to render PDF thumbnail', { status: 502 });
  }

  await writePdfCache(file, rendered.webp, '/api/pdf-thumbnail');
  // The page count came free with the parse above — hand it to /api/pdf-info.
  await writePdfCache(
    pdfCachePath(canonicalUrl, 'pages.json'),
    JSON.stringify({ numPages: rendered.numPages }),
    '/api/pdf-thumbnail'
  );

  return new Response(new Uint8Array(rendered.webp), {
    status: 200,
    headers: { 'content-type': 'image/webp', 'cache-control': CACHE_CONTROL }
  });
}
