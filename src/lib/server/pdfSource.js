/**
 * Shared fetch + on-disk cache plumbing for the app's derived PDF artifacts
 * (thumbnail, page count).
 *
 * Extracted when `/api/pdf-info` was added (#57) rather than copied into it.
 * The reason is #31: `/api/reader` had grown its own private copy of the
 * private-IP check, the two drifted, and the weaker copy is what shipped. The
 * technical guardrails here — http(s) only, private-host block, redirect
 * re-validation, size cap, timeout, content-type check — must be one
 * implementation, not two that look alike.
 *
 * Whether the app may derive an artifact *at all* is a rights question decided
 * client-side by `pdfThumbnailGate.js`; this module only decides whether a
 * fetch is technically safe.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { fetchGuardedRedirects } from '$lib/server/httpUrl.js';

export const MAX_UPSTREAM_SIZE = 50 * 1024 * 1024; // 50MB
export const FETCH_TIMEOUT = 20_000;
export const PDF_CONTENT_TYPES = ['application/pdf', 'application/octet-stream'];

/** Cache root. Shared by every derived artifact so one env var configures all. */
export function pdfCacheDir() {
  return env.PDF_THUMBNAIL_CACHE_DIR || path.join(tmpdir(), 'edufeed-pdf-thumbnails');
}

/**
 * Cache path for a derived artifact, keyed by a hash of the source URL.
 *
 * @param {string} url - the canonical (parsed) source URL
 * @param {string} extension - e.g. 'webp', 'pages.json'
 * @returns {string}
 */
export function pdfCachePath(url, extension) {
  const hash = createHash('sha256').update(url).digest('hex');
  return path.join(pdfCacheDir(), `${hash}.${extension}`);
}

/**
 * Best-effort cache write. Serving the artifact matters more than caching it,
 * so a failure here is logged and swallowed.
 *
 * @param {string} file
 * @param {Buffer | string} contents
 * @param {string} label - endpoint name, for the log line
 */
export async function writePdfCache(file, contents, label) {
  try {
    await mkdir(pdfCacheDir(), { recursive: true });
    await writeFile(file, contents);
  } catch (err) {
    console.warn(`[${label}] cache write failed:`, /** @type {any} */ (err)?.message);
  }
}

/**
 * Fetch PDF bytes with the app's technical guardrails.
 *
 * Redirects are re-validated (`fetchGuardedRedirects`), the size cap is checked
 * both from `content-length` and again against the actual body — a missing or
 * lying header must not get a 50MB+ file past the cap — and the content type
 * has to plausibly be a PDF.
 *
 * @param {string} url - an already-parsed, already-host-checked http(s) URL
 * @returns {Promise<{ ok: true, bytes: Uint8Array } | { ok: false, response: Response }>}
 */
export async function fetchPdfBytes(url) {
  /** @type {Response} */
  let upstream;
  try {
    upstream = await fetchGuardedRedirects(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { accept: 'application/pdf,*/*' }
    });
  } catch {
    return { ok: false, response: new Response('Failed to fetch PDF', { status: 502 }) };
  }

  if (!upstream.ok) {
    return {
      ok: false,
      response: new Response(`Upstream returned ${upstream.status}`, { status: 502 })
    };
  }

  const contentType = (upstream.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!PDF_CONTENT_TYPES.includes(contentType)) {
    return { ok: false, response: new Response('Upstream content is not a PDF', { status: 415 }) };
  }

  const contentLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPSTREAM_SIZE) {
    return { ok: false, response: new Response('PDF too large', { status: 502 }) };
  }

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength > MAX_UPSTREAM_SIZE) {
    return { ok: false, response: new Response('PDF too large', { status: 502 }) };
  }

  return { ok: true, bytes };
}
