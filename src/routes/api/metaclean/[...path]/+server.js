/**
 * Server-side proxy to the metadata-cleaner service (metacleaner).
 *
 * The service sends no CORS headers, so the browser cannot call it directly;
 * this route forwards a strict allowlist of its JSON/file API and keeps
 * METADATA_CLEANER_URL server-side. Mirrors /api/oer's 503-when-unconfigured
 * contract. Anything not on the allowlist is a 404 — notably oer-ops and
 * sidecar, which are deliberately not exposed (out of scope, see issue #47).
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const SESSION_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Map an app-relative path to the upstream metacleaner path, or null when the
 * path/method combination is not allowlisted.
 * @param {string} path - catch-all segment, e.g. "files/abc/ops/strip"
 * @param {string} method
 * @returns {string | null}
 */
function resolveUpstreamPath(path, method) {
  if (method === 'POST' && path === 'files') return '/api/files';
  const parts = path.split('/');
  if (parts[0] !== 'files' || parts.length < 3 || !SESSION_ID.test(parts[1])) return null;
  const rest = parts.slice(2).join('/');
  if (method === 'GET' && rest === 'ops/strip') return `/api/files/${parts[1]}/ops/strip`;
  if (method === 'POST' && rest === 'apply') return `/api/files/${parts[1]}/apply`;
  if (method === 'GET' && rest === 'download') return `/api/files/${parts[1]}/download`;
  return null;
}

/** @param {import('@sveltejs/kit').RequestEvent} event */
async function proxy(event) {
  const baseUrl = env.METADATA_CLEANER_URL;
  if (!baseUrl) {
    return json({ error: 'Metadata cleaner not configured' }, { status: 503 });
  }

  const method = event.request.method;
  const upstreamPath = resolveUpstreamPath(event.params.path ?? '', method);
  if (!upstreamPath) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  /** @type {RequestInit} */
  const init = { method, headers: {} };
  if (method === 'POST') {
    const contentType = event.request.headers.get('content-type');
    if (contentType) init.headers = { 'content-type': contentType };

    // Cap the buffered body: this route is a public endpoint reachable
    // directly (not just through the UI pickers' max-file-size), so an
    // unbounded arrayBuffer() read is a memory-exhaustion DoS vector.
    // Deliberately independent of BLOSSOM_MAX_FILE_SIZE — an oversized PDF
    // must still reach the cleaner so its compression can shrink it below
    // the upload limit. Default mirrors the service's own -max-upload-mb.
    const maxBytes = (parseInt(env.METADATA_CLEANER_MAX_UPLOAD_MB ?? '', 10) || 200) * 1024 * 1024;
    const contentLength = event.request.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      return json({ error: 'Request body too large' }, { status: 413 });
    }

    // Buffer the body (avoids undici duplex quirks), re-checking the size in
    // case content-length was absent or dishonest.
    const buffer = await event.request.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return json({ error: 'Request body too large' }, { status: 413 });
    }
    init.body = buffer;
  }

  let upstream;
  try {
    upstream = await event.fetch(baseUrl.replace(/\/+$/, '') + upstreamPath, init);
  } catch (err) {
    console.error('[/api/metaclean] upstream request failed:', err);
    return json({ error: 'Metadata cleaner unreachable' }, { status: 502 });
  }

  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = proxy;
export const POST = proxy;
