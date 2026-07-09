// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CACHE_DIR = mkdtempSync(path.join(tmpdir(), 'pdf-thumb-test-'));
process.env.PDF_THUMBNAIL_CACHE_DIR = CACHE_DIR;

const { GET } = await import('../+server.js');

/** Minimal valid one-page PDF (200x300, blank). Parses in pdf.js. */
const MINIMAL_PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 300]>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF';

/** @param {Record<string, string>} params */
function makeEvent(params) {
  const url = new URL('http://localhost/api/pdf-thumbnail');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return /** @type {any} */ ({ url });
}

function pdfResponse() {
  const bytes = new TextEncoder().encode(MINIMAL_PDF);
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length) }
  });
}

describe('/api/pdf-thumbnail', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeAll(() => () => rmSync(CACHE_DIR, { recursive: true, force: true }));

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('rejects missing/invalid/private urls', async () => {
    expect((await GET(makeEvent({}))).status).toBe(400);
    expect((await GET(makeEvent({ url: 'ftp://x/y.pdf' }))).status).toBe(400);
    expect((await GET(makeEvent({ url: 'http://192.168.0.1/y.pdf' }))).status).toBe(400);
  });

  it('renders a webp thumbnail from an upstream PDF and caches it', async () => {
    fetchSpy.mockResolvedValueOnce(pdfResponse());

    // Unique per run — the cache dir may fall back to the shared tmpdir when
    // another test file loaded $env/dynamic/private before our env override.
    const uniqueUrl = `https://journal.example/paper-${crypto.randomUUID()}.pdf`;
    const res = await GET(makeEvent({ url: uniqueUrl }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const body = new Uint8Array(await res.arrayBuffer());
    // RIFF....WEBP magic
    expect(String.fromCharCode(...body.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...body.slice(8, 12))).toBe('WEBP');

    // Second request must be served from cache — no upstream fetch
    const res2 = await GET(makeEvent({ url: uniqueUrl }));
    expect(res2.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects non-PDF upstream content', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    );
    const res = await GET(makeEvent({ url: 'https://journal.example/page-nonpdf' }));
    expect(res.status).toBe(415);
  });

  it('returns 502 when the PDF cannot be rendered', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('not a pdf at all', {
        status: 200,
        headers: { 'content-type': 'application/pdf' }
      })
    );
    const res = await GET(makeEvent({ url: 'https://journal.example/broken.pdf' }));
    expect(res.status).toBe(502);
  });
});
