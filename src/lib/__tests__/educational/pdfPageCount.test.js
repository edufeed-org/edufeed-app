import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadPdfPageCount, clearPdfPageCountCache } from '$lib/helpers/educational/pdfPageCount.js';

/** @param {unknown} body */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('loadPdfPageCount', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let fetchSpy;

  beforeEach(() => {
    clearPdfPageCountCache();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('reads numPages from /api/pdf-info, url-encoded', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ numPages: 12 }));

    expect(await loadPdfPageCount('https://x.example/a b.pdf')).toBe(12);
    expect(fetchSpy).toHaveBeenCalledWith('/api/pdf-info?url=https%3A%2F%2Fx.example%2Fa%20b.pdf');
  });

  it('memoises per url — a feed of cards costs one request', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ numPages: 3 }));

    expect(await loadPdfPageCount('https://x.example/a.pdf')).toBe(3);
    expect(await loadPdfPageCount('https://x.example/a.pdf')).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent hovers on the same url', async () => {
    /** @type {(r: Response) => void} */
    let release = () => {};
    fetchSpy.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const both = Promise.all([
      loadPdfPageCount('https://x.example/slow.pdf'),
      loadPdfPageCount('https://x.example/slow.pdf')
    ]);
    release(jsonResponse({ numPages: 7 }));

    expect(await both).toEqual([7, 7]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('remembers a failure as null — a card must not retry a 404 on every hover', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 404 }));

    expect(await loadPdfPageCount('https://x.example/missing.pdf')).toBeNull();
    expect(await loadPdfPageCount('https://x.example/missing.pdf')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null for a network error rather than rejecting', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('offline'));

    await expect(loadPdfPageCount('https://x.example/offline.pdf')).resolves.toBeNull();
  });

  it('rejects a nonsense count instead of rendering it', async () => {
    // 0, negative and non-integer counts are not page counts. A body with no
    // numPages at all is the shape a misrouted 200 would have.
    for (const body of [{ numPages: 0 }, { numPages: -1 }, { numPages: 1.5 }, {}]) {
      clearPdfPageCountCache();
      fetchSpy.mockResolvedValueOnce(jsonResponse(body));
      expect(await loadPdfPageCount('https://x.example/odd.pdf')).toBeNull();
    }
  });

  it('returns null for an empty url without fetching', async () => {
    expect(await loadPdfPageCount('')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
