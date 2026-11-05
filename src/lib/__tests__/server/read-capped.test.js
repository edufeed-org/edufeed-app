/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readCapped } from '$lib/server/httpUrl.js';
import { fetchPublicImage } from '$lib/server/image-fetch.js';
import { fetchPdfBytes } from '$lib/server/pdfSource.js';

/**
 * A response whose body is an endless stream of 1 KB chunks without a
 * Content-Length, so only a streaming cap can stop it. `pulled.count` says how
 * many chunks were read before the consumer gave up.
 *
 * @param {Record<string, string>} headers
 * @param {number} [chunkSize]
 */
function endless(headers = {}, chunkSize = 1024) {
  const pulled = { count: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      pulled.count++;
      controller.enqueue(new Uint8Array(chunkSize));
    },
    cancel() {
      pulled.cancelled = true;
    }
  });
  return { response: new Response(body, { status: 200, headers }), pulled };
}

afterEach(() => vi.unstubAllGlobals());

describe('readCapped', () => {
  it('returns the whole body when under the cap', async () => {
    const bytes = await readCapped(new Response(new Uint8Array([1, 2, 3])), 10);
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
  });

  it('returns null and cancels the stream once over the cap', async () => {
    const { response, pulled } = endless();
    expect(await readCapped(response, 4096)).toBeNull();
    expect(pulled.cancelled).toBe(true);
    expect(pulled.count).toBeLessThan(10);
  });
});

describe('capped upstream reads', () => {
  it('fetchPublicImage stops reading an oversized body without Content-Length', async () => {
    const { response, pulled } = endless({ 'content-type': 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const result = await fetchPublicImage('https://93.184.216.34/x.png', { maxSize: 4096 });
    expect(result).toMatchObject({ ok: false, status: 502, message: 'Upstream image too large' });
    expect(pulled.cancelled).toBe(true);
  });

  it('fetchPdfBytes stops reading an oversized body without Content-Length', async () => {
    const { response, pulled } = endless({ 'content-type': 'application/pdf' }, 1024 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    );
    const result = await fetchPdfBytes('https://93.184.216.34/x.pdf');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(502);
    expect(pulled.cancelled).toBe(true);
  });
});
