// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const { GET } = await import('../../routes/api/oer/asset/+server.js');

/** Build a GET RequestEvent for ?url=. */
function ev(rawUrl) {
  const u = new URL('http://localhost/api/oer/asset');
  if (rawUrl !== undefined) u.searchParams.set('url', rawUrl);
  return { url: u };
}

/** Stub global.fetch to return image bytes with a content-type. */
function stubFetch({ bytes, contentType = 'image/jpeg', ok = true, status = 200 }) {
  return vi.fn(async () => ({
    ok,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }));
}

describe('GET /api/oer/asset', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('returns 400 when url is missing', async () => {
    const res = await GET(ev(undefined));
    expect(res.status).toBe(400);
  });

  it('rejects non-http(s) urls', async () => {
    const res = await GET(ev('file:///etc/passwd'));
    expect(res.status).toBe(400);
  });

  it('rejects private/loopback urls (SSRF guard)', async () => {
    const res = await GET(ev('http://127.0.0.1/secret.png'));
    expect(res.status).toBe(400);
  });

  it('rejects a non-image upstream content-type', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', stubFetch({ bytes, contentType: 'text/html' }));
    const res = await GET(ev('https://evil.example/page.html'));
    expect(res.status).toBe(502);
  });

  it('returns sha256/mime/size for a valid image', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const expectedSha = createHash('sha256').update(bytes).digest('hex');
    vi.stubGlobal('fetch', stubFetch({ bytes, contentType: 'image/png' }));
    const res = await GET(ev('https://upload.wikimedia.org/x.png'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha256: expectedSha, mime: 'image/png', size: 5 });
  });

  it('returns 502 on a non-ok upstream response', async () => {
    const bytes = new Uint8Array([1]);
    vi.stubGlobal('fetch', stubFetch({ bytes, ok: false, status: 404 }));
    const res = await GET(ev('https://upload.wikimedia.org/missing.png'));
    expect(res.status).toBe(502);
  });
});
