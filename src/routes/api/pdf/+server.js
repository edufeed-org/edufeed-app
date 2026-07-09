/**
 * PDF proxy for the inline preview.
 *
 * pdf.js fetches PDFs client-side, which fails for external hosts without
 * CORS headers (journal servers, OJS download links). PdfInlineViewer
 * retries through this endpoint on a failed direct fetch. Mirrors
 * /api/image's guardrails: http(s) only, private-IP block, size cap,
 * upstream timeout, content-type check.
 */

import { parseHttpUrl, isPrivateIp } from '$lib/server/httpUrl.js';

const MAX_UPSTREAM_SIZE = 50 * 1024 * 1024; // 50MB
const FETCH_TIMEOUT = 20_000;

const PDF_CONTENT_TYPES = ['application/pdf', 'application/octet-stream'];

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
  if (isPrivateIp(parsed)) {
    return new Response('Private/local URLs are not allowed', { status: 400 });
  }

  /** @type {Response} */
  let upstream;
  try {
    upstream = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { accept: 'application/pdf,*/*' },
      redirect: 'follow'
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

  /** @type {HeadersInit} */
  const headers = {
    'content-type': 'application/pdf',
    'cache-control': 'public, max-age=3600'
  };
  if (Number.isFinite(contentLength) && contentLength > 0) {
    headers['content-length'] = String(contentLength);
  }

  return new Response(upstream.body, { status: 200, headers });
}
