// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../+server.js';

/**
 * Build a SvelteKit-shaped RequestEvent fixture pointing at /api/reader with
 * the given query params.
 *
 * @param {Record<string, string>} params
 */
function makeEvent(params) {
  const url = new URL('http://localhost/api/reader');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return /** @type {any} */ ({ url });
}

describe('/api/reader (PDF short-circuit for mode=metadata)', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns metadata=none for a PDF URL in metadata mode (no body read, no size cap)', async () => {
    // The upstream PDF advertises 8MB via Content-Length — the existing 5MB
    // cap would have rejected this with 502 "Content too large". The
    // short-circuit must short-circuit on Content-Type alone, before that
    // check runs.
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(8 * 1024 * 1024)
        }
      })
    );

    const res = await GET(makeEvent({ mode: 'metadata', url: 'https://example.com/big.pdf' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, metadata: { source: 'none' } });
  });

  it('still rejects oversized PDFs with 502 when mode is NOT metadata (full extract path unchanged)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(8 * 1024 * 1024)
        }
      })
    );

    // No mode param → full extraction path, where the 5MB cap legitimately
    // applies (we'd OOM trying to extract text from a 50MB PDF).
    const res = await GET(makeEvent({ url: 'https://example.com/big.pdf' }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/too large/i);
  });
});
