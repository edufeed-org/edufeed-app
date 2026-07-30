/**
 * App-side PDF thumbnail endpoint (issue #24).
 *
 * Renders page 1 of a PDF to a ~400px WebP, cached on disk keyed by the URL
 * hash. Thumbnails are an app-level presentation concern — they are never
 * written onto the user's Nostr event; cards simply point an <img> here.
 * Whether a thumbnail is *allowed* (open license / attested upload) is
 * decided client-side by `pdfThumbnailGate.js`; this endpoint mirrors
 * /api/pdf's technical guardrails (http(s) only, private-IP block via
 * guarded redirects, size cap, timeout, content-type check).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { parseHttpUrl, isBlockedHost, fetchGuardedRedirects } from '$lib/server/httpUrl.js';
import { renderPdfThumbnail } from '$lib/server/pdfThumbnail.js';

const MAX_UPSTREAM_SIZE = 50 * 1024 * 1024; // 50MB
const FETCH_TIMEOUT = 20_000;
const PDF_CONTENT_TYPES = ['application/pdf', 'application/octet-stream'];

/** Browser + CDN may cache aggressively — thumbnails are immutable per URL. */
const CACHE_CONTROL = 'public, max-age=86400, immutable';

function cacheDir() {
  return env.PDF_THUMBNAIL_CACHE_DIR || path.join(tmpdir(), 'edufeed-pdf-thumbnails');
}

/** @param {string} url */
function cachePath(url) {
  const hash = createHash('sha256').update(url).digest('hex');
  return path.join(cacheDir(), `${hash}.webp`);
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

  // Cache hit → serve immediately
  const file = cachePath(parsed.toString());
  try {
    const cached = await readFile(file);
    return new Response(new Uint8Array(cached), {
      status: 200,
      headers: { 'content-type': 'image/webp', 'cache-control': CACHE_CONTROL }
    });
  } catch {
    // miss — render below
  }

  /** @type {Response} */
  let upstream;
  try {
    upstream = await fetchGuardedRedirects(parsed.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { accept: 'application/pdf,*/*' }
    });
  } catch {
    return new Response('Failed to fetch PDF', { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(`Upstream returned ${upstream.status}`, { status: 502 });
  }
  const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!PDF_CONTENT_TYPES.includes(contentType)) {
    return new Response('Upstream content is not a PDF', { status: 415 });
  }
  const contentLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPSTREAM_SIZE) {
    return new Response('PDF too large', { status: 502 });
  }

  /** @type {Buffer} */
  let webp;
  try {
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_UPSTREAM_SIZE) {
      return new Response('PDF too large', { status: 502 });
    }
    webp = await renderPdfThumbnail(bytes);
  } catch (err) {
    console.warn('[/api/pdf-thumbnail] render failed:', /** @type {any} */ (err)?.message);
    return new Response('Failed to render PDF thumbnail', { status: 502 });
  }

  // Best-effort cache write — serving the thumbnail matters more
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(file, webp);
  } catch (err) {
    console.warn('[/api/pdf-thumbnail] cache write failed:', /** @type {any} */ (err)?.message);
  }

  return new Response(new Uint8Array(webp), {
    status: 200,
    headers: { 'content-type': 'image/webp', 'cache-control': CACHE_CONTROL }
  });
}
