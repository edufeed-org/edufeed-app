import sharp from 'sharp';
import { fetchPublicImage } from '$lib/server/image-fetch.js';

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const DEFAULT_QUALITY = 80;

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

  // Clamp dimensions
  const width = Math.min(Math.max(w || 0, 0), MAX_WIDTH) || undefined;
  const height = Math.min(Math.max(h || 0, 0), MAX_HEIGHT) || undefined;
  const quality = Math.min(Math.max(q || DEFAULT_QUALITY, 1), 100);

  if (!width && !height) {
    return new Response('At least one of w or h is required', { status: 400 });
  }

  // URL validation, SSRF guard, timeout, content-type and size checks are
  // shared with /api/image-hash.
  const upstream = await fetchPublicImage(imageUrl);
  if (!upstream.ok) {
    return new Response(upstream.message, { status: upstream.status });
  }
  const buffer = upstream.buffer;

  try {
    // Animated sources (GIF, animated WebP/APNG) keep their frames only for
    // webp output — jpeg/png can't animate, so those flatten to frame 1.
    const animated = fmtParam === 'webp';

    // 'cover' fills the exact w×h box (used for link-preview images that must
    // declare fixed dimensions); 'inside' preserves aspect ratio without upscaling.
    const pipeline = sharp(buffer, { animated })
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
  } catch {
    return new Response('Image processing failed', { status: 502 });
  }
}
