/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { GET } from '../../routes/api/image-hash/+server.js';

/**
 * Stub global.fetch to answer with the given bytes as an upstream image.
 * @param {Buffer} buffer
 * @param {{ contentType?: string, contentLength?: string, status?: number }} [opts]
 */
function stubUpstream(buffer, { contentType = 'image/png', contentLength, status = 200 } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (/** @type {string} */ name) => {
        const key = name.toLowerCase();
        if (key === 'content-type') return contentType;
        if (key === 'content-length') return contentLength ?? null;
        return null;
      }
    },
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** @param {string} query */
function callGET(query) {
  const url = new URL(`http://localhost/api/image-hash?${query}`);
  return GET(/** @type {any} */ ({ url }));
}

describe('/api/image-hash', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the sha256, size and mime of a public image', async () => {
    const bytes = Buffer.from('not really a png but hashed all the same');
    stubUpstream(bytes, { contentType: 'image/png; charset=binary' });

    const res = await callGET('url=https%3A%2F%2Fexample.com%2Fa.png');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      mime: 'image/png'
    });
  });

  it('rejects a missing or non-http url', async () => {
    expect((await callGET('')).status).toBe(400);
    expect((await callGET('url=ftp%3A%2F%2Fexample.com%2Fa.png')).status).toBe(400);
    expect((await callGET('url=not-a-url')).status).toBe(400);
  });

  it('refuses private and local hosts without fetching', async () => {
    const fetchMock = stubUpstream(Buffer.from('x'));
    expect((await callGET('url=http%3A%2F%2F127.0.0.1%2Fa.png')).status).toBe(400);
    expect((await callGET('url=http%3A%2F%2F10.1.2.3%2Fa.png')).status).toBe(400);
    expect((await callGET('url=http%3A%2F%2Fprinter.local%2Fa.png')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 502 when the upstream is not an image', async () => {
    stubUpstream(Buffer.from('<html></html>'), { contentType: 'text/html' });
    const res = await callGET('url=https%3A%2F%2Fexample.com%2Fpage');
    expect(res.status).toBe(502);
  });

  it('answers 502 when the upstream declares a body above the size limit', async () => {
    stubUpstream(Buffer.from('x'), { contentLength: String(30 * 1024 * 1024) });
    const res = await callGET('url=https%3A%2F%2Fexample.com%2Fhuge.png');
    expect(res.status).toBe(502);
  });

  it('answers 502 when the upstream fetch fails', async () => {
    stubUpstream(Buffer.from('x'), { status: 404 });
    const res = await callGET('url=https%3A%2F%2Fexample.com%2Fmissing.png');
    expect(res.status).toBe(502);
  });
});
