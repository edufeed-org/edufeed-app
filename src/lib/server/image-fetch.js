import { isBlockedHost, fetchGuardedRedirects } from '$lib/server/httpUrl.js';

/** Upstream bytes the image endpoints are willing to pull. */
export const MAX_UPSTREAM_IMAGE_SIZE = 25 * 1024 * 1024; // 25MB
const FETCH_TIMEOUT = 10_000;

/**
 * @typedef {{ ok: true, buffer: Buffer, contentType: string }} ImageFetchOk
 * @typedef {{ ok: false, status: number, message: string }} ImageFetchError
 */

/**
 * Validate a user-supplied image URL and fetch its bytes server-side with the
 * guards every image endpoint needs: http(s) only, no private/local hosts,
 * redirects re-validated hop by hop, a hard timeout, an `image/*` content type
 * and a size cap checked both from the header and from the actual body.
 *
 * Returns a result object instead of throwing so each endpoint can map the
 * failure to its own Response without duplicating the checks.
 *
 * @param {string | null} imageUrl
 * @param {{ maxSize?: number, timeout?: number, lookup?: import('./httpUrl.js').DnsLookupAll }} [opts]
 * @returns {Promise<ImageFetchOk | ImageFetchError>}
 */
export async function fetchPublicImage(
  imageUrl,
  { maxSize = MAX_UPSTREAM_IMAGE_SIZE, timeout = FETCH_TIMEOUT, lookup } = {}
) {
  if (!imageUrl) {
    return { ok: false, status: 400, message: 'Missing url parameter' };
  }

  /** @type {URL} */
  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return { ok: false, status: 400, message: 'Invalid url parameter' };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, status: 400, message: 'URL must be http or https' };
  }

  if (await isBlockedHost(parsedUrl, lookup)) {
    return { ok: false, status: 400, message: 'Private/local URLs are not allowed' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const upstream = await fetchGuardedRedirects(
      imageUrl,
      { signal: controller.signal, headers: { Accept: 'image/*' } },
      undefined,
      lookup
    );

    if (!upstream.ok) {
      return { ok: false, status: 502, message: 'Upstream image fetch failed' };
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return { ok: false, status: 502, message: 'Upstream resource is not an image' };
    }

    const contentLength = parseInt(upstream.headers.get('content-length') || '0', 10);
    if (contentLength > maxSize) {
      return { ok: false, status: 502, message: 'Upstream image too large' };
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > maxSize) {
      return { ok: false, status: 502, message: 'Upstream image too large' };
    }

    return { ok: true, buffer, contentType };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, status: 504, message: 'Upstream image fetch timed out' };
    }
    return { ok: false, status: 502, message: 'Upstream image fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}
