import sharp from 'sharp';
import { isPrivateIp, fetchGuardedRedirects } from '$lib/server/httpUrl.js';

const MAX_UPSTREAM_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const DEFAULT_QUALITY = 80;
const FETCH_TIMEOUT = 10_000;

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
  const imageUrl = url.searchParams.get('url');
  const w = parseInt(url.searchParams.get('w') || '0', 10);
  const h = parseInt(url.searchParams.get('h') || '0', 10);
  const q = parseInt(url.searchParams.get('q') || String(DEFAULT_QUALITY), 10);
  const fitParam = url.searchParams.get('fit') === 'cover' ? 'cover' : 'inside';
  const fmtParam = (() => {
    const f = url.searchParams.get('fmt');
    if (f === 'jpeg' || f === 'jpg') return 'jpeg';
    if (f === 'png') return 'png';
    return 'webp';
  })();

  if (!imageUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }

  // Validate URL format
  /** @type {URL} */
  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return new Response('Invalid url parameter', { status: 400 });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return new Response('URL must be http or https', { status: 400 });
  }

  if (isPrivateIp(parsedUrl)) {
    return new Response('Private/local URLs are not allowed', { status: 400 });
  }

  // Clamp dimensions
  const width = Math.min(Math.max(w || 0, 0), MAX_WIDTH) || undefined;
  const height = Math.min(Math.max(h || 0, 0), MAX_HEIGHT) || undefined;
  const quality = Math.min(Math.max(q || DEFAULT_QUALITY, 1), 100);

  if (!width && !height) {
    return new Response('At least one of w or h is required', { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const upstream = await fetchGuardedRedirects(imageUrl, {
      signal: controller.signal,
      headers: { Accept: 'image/*' }
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      return new Response('Upstream image fetch failed', { status: 502 });
    }

    // Check content type
    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return new Response('Upstream resource is not an image', { status: 502 });
    }

    // Check content length if available
    const contentLength = parseInt(upstream.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_UPSTREAM_SIZE) {
      return new Response('Upstream image too large', { status: 502 });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());

    if (buffer.length > MAX_UPSTREAM_SIZE) {
      return new Response('Upstream image too large', { status: 502 });
    }

    // 'cover' fills the exact w×h box (used for link-preview images that must
    // declare fixed dimensions); 'inside' preserves aspect ratio without upscaling.
    const pipeline = sharp(buffer)
      .rotate()
      .resize(width, height, {
        fit: fitParam,
        withoutEnlargement: fitParam !== 'cover'
      });

    let outBuffer;
    /** @type {string} */
    let outContentType;
    if (fmtParam === 'jpeg') {
      outBuffer = await pipeline.jpeg({ quality }).toBuffer();
      outContentType = 'image/jpeg';
    } else if (fmtParam === 'png') {
      outBuffer = await pipeline.png().toBuffer();
      outContentType = 'image/png';
    } else {
      outBuffer = await pipeline.webp({ quality }).toBuffer();
      outContentType = 'image/webp';
    }

    return new Response(new Uint8Array(outBuffer), {
      headers: {
        'Content-Type': outContentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        'Content-Length': String(outBuffer.length)
      }
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return new Response('Upstream image fetch timed out', { status: 504 });
    }
    return new Response('Image processing failed', { status: 502 });
  }
}
