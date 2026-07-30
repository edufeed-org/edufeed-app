/**
 * Original-bytes hash endpoint for OER picks.
 *
 * `GET /api/oer/asset?url=<original image URL>` → `{ sha256, mime, size }`.
 * Fetches the original bytes server-side and content-addresses them so the
 * kind-1063 attestation's `x` tag matches the true source image — which lets
 * attestations be shared network-wide with anyone using that same image.
 * No transcode (unlike /api/image): we hash exactly what the source served.
 *
 * Same SSRF threat model as /api/image (arbitrary URLs from search results):
 * http(s) only + shared isBlockedHost guard, non-image rejection, size + timeout
 * caps. On the homelab the upstream proxy/imgproxy adds ASSET_PROXY_ALLOWED_
 * DOMAINS + network isolation for defence in depth.
 */

import { json } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { parseHttpUrl, isBlockedHost } from '$lib/server/httpUrl.js';

const MAX_SIZE = 25 * 1024 * 1024; // 25MB
const FETCH_TIMEOUT = 15_000;

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
  const rawUrl = url.searchParams.get('url');
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) {
    return json({ error: 'Missing or invalid url' }, { status: 400 });
  }
  if (await isBlockedHost(parsed)) {
    return json({ error: 'Private/local URLs are not allowed' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const upstream = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { Accept: 'image/*' }
    });
    if (!upstream.ok) {
      return json({ error: 'Upstream image fetch failed' }, { status: 502 });
    }
    const mime = (upstream.headers.get('content-type') || '').split(';')[0].trim();
    if (!mime.startsWith('image/')) {
      return json({ error: 'Upstream resource is not an image' }, { status: 502 });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_SIZE) {
      return json({ error: 'Upstream image too large' }, { status: 502 });
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    return json({ sha256, mime, size: buffer.length }, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return json({ error: 'Upstream image fetch timed out' }, { status: 504 });
    }
    console.error('[/api/oer/asset] fetch/hash failed:', err);
    return json({ error: 'Asset hashing failed' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
