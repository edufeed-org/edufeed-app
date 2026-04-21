import sharp from 'sharp';

const MAX_UPSTREAM_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const DEFAULT_QUALITY = 80;
const FETCH_TIMEOUT = 10_000;

/**
 * @param {URL} parsedUrl
 * @returns {boolean}
 */
function isPrivateIp(parsedUrl) {
  const hostname = parsedUrl.hostname;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('172.') ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local')
  );
}

/** @type {import('@sveltejs/kit').RequestHandler} */
export async function GET({ url }) {
  const imageUrl = url.searchParams.get('url');
  const w = parseInt(url.searchParams.get('w') || '0', 10);
  const h = parseInt(url.searchParams.get('h') || '0', 10);
  const q = parseInt(url.searchParams.get('q') || String(DEFAULT_QUALITY), 10);

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

    const upstream = await fetch(imageUrl, {
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

    const resized = await sharp(buffer)
      .rotate()
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    return new Response(new Uint8Array(resized), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
        'Content-Length': String(resized.length)
      }
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return new Response('Upstream image fetch timed out', { status: 504 });
    }
    return new Response('Image processing failed', { status: 502 });
  }
}
