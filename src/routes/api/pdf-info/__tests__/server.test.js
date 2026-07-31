// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const CACHE_DIR = mkdtempSync(path.join(tmpdir(), 'pdf-info-test-'));
process.env.PDF_THUMBNAIL_CACHE_DIR = CACHE_DIR;

const { GET } = await import('../+server.js');
const { GET: THUMBNAIL_GET } = await import('../../pdf-thumbnail/+server.js');
const { pdfCacheDir } = await import('$lib/server/pdfSource.js');

/** Minimal valid one-page PDF (200x300, blank). Parses in pdf.js. */
const MINIMAL_PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 300]>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF';

/** @param {Record<string, string>} params */
function makeEvent(params) {
  const url = new URL('http://localhost/api/pdf-info');
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

/**
 * Write a sidecar the way `/api/pdf-thumbnail` does, so the "answers from the
 * thumbnail's parse" path can be exercised without rendering anything.
 *
 * Resolved through `pdfCacheDir()` rather than CACHE_DIR: the module reads
 * `$env/dynamic/private`, which another test file may have loaded before our
 * env override landed, in which case the real dir is the shared tmpdir. Same
 * hazard the thumbnail test works around with a per-run unique URL.
 *
 * @param {string} url - the canonical URL, i.e. `new URL(x).toString()`
 * @param {string} contents
 */
function seedSidecar(url, contents) {
  const dir = pdfCacheDir();
  mkdirSync(dir, { recursive: true });
  const hash = createHash('sha256').update(url).digest('hex');
  writeFileSync(path.join(dir, `${hash}.pages.json`), contents);
}

describe('/api/pdf-info', () => {
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
    // Nothing was fetched on any of the rejections.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('derives the page count from the file and caches it', async () => {
    fetchSpy.mockResolvedValueOnce(pdfResponse());

    const uniqueUrl = `https://journal.example/paper-${crypto.randomUUID()}.pdf`;
    const res = await GET(makeEvent({ url: uniqueUrl }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ numPages: 1 });

    // Second request must be served from the sidecar — no upstream fetch.
    const res2 = await GET(makeEvent({ url: uniqueUrl }));
    expect(await res2.json()).toEqual({ numPages: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('answers from a sidecar written by the thumbnail render, without fetching', async () => {
    const uniqueUrl = `https://journal.example/rendered-${crypto.randomUUID()}.pdf`;
    seedSidecar(new URL(uniqueUrl).toString(), JSON.stringify({ numPages: 12 }));

    const res = await GET(makeEvent({ url: uniqueUrl }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ numPages: 12 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('re-derives rather than serving a corrupt sidecar', async () => {
    const uniqueUrl = `https://journal.example/corrupt-${crypto.randomUUID()}.pdf`;
    // Truncated JSON, and a well-formed sidecar carrying a nonsense count: both
    // must fall through to the file rather than be served as a page count.
    for (const bad of ['{"numPages":', JSON.stringify({ numPages: 0 })]) {
      seedSidecar(new URL(uniqueUrl).toString(), bad);
      fetchSpy.mockResolvedValueOnce(pdfResponse());

      const res = await GET(makeEvent({ url: uniqueUrl }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ numPages: 1 });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects non-PDF upstream content', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    );
    const res = await GET(makeEvent({ url: 'https://journal.example/page-nonpdf-info' }));
    expect(res.status).toBe(415);
  });

  it('returns 502 when the PDF cannot be parsed', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('not a pdf at all', {
        status: 200,
        headers: { 'content-type': 'application/pdf' }
      })
    );
    const res = await GET(makeEvent({ url: 'https://journal.example/broken-info.pdf' }));
    expect(res.status).toBe(502);
  });

  it('rides on the thumbnail render — a card with a cover costs no second fetch', async () => {
    // The whole efficiency argument for the sidecar: /api/pdf-thumbnail already
    // parsed this document, so the count must come off disk here. If the two
    // endpoints ever disagree on the cache key this fetches twice.
    const uniqueUrl = `https://journal.example/covered-${crypto.randomUUID()}.pdf`;
    fetchSpy.mockResolvedValueOnce(pdfResponse());

    const cover = await THUMBNAIL_GET(makeEvent({ url: uniqueUrl }));
    expect(cover.status).toBe(200);

    const res = await GET(makeEvent({ url: uniqueUrl }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ numPages: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not render anything — no canvas, no webp is written', async () => {
    fetchSpy.mockResolvedValueOnce(pdfResponse());
    const uniqueUrl = `https://journal.example/norender-${crypto.randomUUID()}.pdf`;
    await GET(makeEvent({ url: uniqueUrl }));

    const hash = createHash('sha256').update(new URL(uniqueUrl).toString()).digest('hex');
    const { existsSync } = await import('node:fs');
    expect(existsSync(path.join(pdfCacheDir(), `${hash}.pages.json`))).toBe(true);
    expect(existsSync(path.join(pdfCacheDir(), `${hash}.webp`))).toBe(false);
  });
});
