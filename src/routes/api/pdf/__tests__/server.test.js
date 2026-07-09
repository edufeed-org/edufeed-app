// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '../+server.js';

/** @param {Record<string, string>} params */
function makeEvent(params) {
  const url = new URL('http://localhost/api/pdf');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return /** @type {any} */ ({ url });
}

describe('/api/pdf (CORS proxy for inline PDF preview)', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('streams a PDF back with the pdf content type', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 fake');
    fetchSpy.mockResolvedValueOnce(
      new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length) }
      })
    );

    const res = await GET(makeEvent({ url: 'https://journal.example/download/569/493' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(body)).toBe('%PDF-1.7 fake');
  });

  it('rejects missing or non-http urls', async () => {
    expect((await GET(makeEvent({}))).status).toBe(400);
    expect((await GET(makeEvent({ url: 'ftp://x/y.pdf' }))).status).toBe(400);
    expect((await GET(makeEvent({ url: 'not a url' }))).status).toBe(400);
  });

  it('rejects private/local hosts', async () => {
    expect((await GET(makeEvent({ url: 'http://127.0.0.1/x.pdf' }))).status).toBe(400);
    expect((await GET(makeEvent({ url: 'http://192.168.1.5/x.pdf' }))).status).toBe(400);
  });

  it('rejects non-PDF upstream content', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    );
    const res = await GET(makeEvent({ url: 'https://journal.example/page' }));
    expect(res.status).toBe(415);
  });

  it('rejects oversized upstream content by Content-Length', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(100 * 1024 * 1024)
        }
      })
    );
    const res = await GET(makeEvent({ url: 'https://journal.example/huge.pdf' }));
    expect(res.status).toBe(502);
  });

  it('propagates upstream failure as 502', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res = await GET(makeEvent({ url: 'https://journal.example/missing.pdf' }));
    expect(res.status).toBe(502);
  });
});
