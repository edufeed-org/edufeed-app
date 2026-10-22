import { createHash } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { fetchPublicImage } from '$lib/server/image-fetch.js';

/**
 * `GET /api/image-hash?url=` → `{ sha256, size, mime }` of a public image.
 *
 * The browser cannot hash a foreign image itself (CORS), but a kind-1063
 * license attestation is keyed by the file's SHA-256. This lets the resource
 * form attest a license for a pasted external image URL, not only for Blossom
 * uploads. Same SSRF/size/timeout guards as `/api/image`.
 *
 * @type {import('@sveltejs/kit').RequestHandler}
 */
export async function GET({ url }) {
  const result = await fetchPublicImage(url.searchParams.get('url'));
  if (!result.ok) {
    return new Response(result.message, { status: result.status });
  }

  return json(
    {
      sha256: createHash('sha256').update(result.buffer).digest('hex'),
      size: result.buffer.length,
      mime: result.contentType.split(';')[0].trim()
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  );
}
