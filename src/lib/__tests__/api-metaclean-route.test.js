// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { METADATA_CLEANER_URL: 'https://cleaner.example' }
}));

const { GET, POST } = await import('../../routes/api/metaclean/[...path]/+server.js');

/** Build a RequestEvent-ish object for the catch-all route. */
function ev(path, { method = 'GET', body = null, contentType = null } = {}) {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  return {
    params: { path },
    request: new Request(`http://localhost/api/metaclean/${path}`, {
      method,
      headers,
      body
    }),
    fetch: fetchMock
  };
}

let fetchMock;

function upstreamResponse(body = '{"ok":true}', init = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => upstreamResponse());
});

describe('/api/metaclean allowlist', () => {
  it('POST files forwards to upstream /api/files with the request body', async () => {
    const res = await POST(
      ev('files', {
        method: 'POST',
        body: 'FILEBYTES',
        contentType: 'multipart/form-data; boundary=x'
      })
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cleaner.example/api/files');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toContain('multipart/form-data');
  });

  it('GET ops/strip forwards with validated session id', async () => {
    const res = await GET(ev('files/abc-123/ops/strip'));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://cleaner.example/api/files/abc-123/ops/strip');
  });

  it('POST apply forwards JSON', async () => {
    const res = await POST(
      ev('files/abc-123/apply', {
        method: 'POST',
        body: '{"ops":[]}',
        contentType: 'application/json'
      })
    );
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://cleaner.example/api/files/abc-123/apply');
  });

  it('GET download passes through content-disposition', async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse('bytes', {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="doc-clean.pdf"'
        }
      })
    );
    const res = await GET(ev('files/abc-123/download'));
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="doc-clean.pdf"');
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('rejects unknown paths with 404 and never calls upstream', async () => {
    for (const path of ['oer-ops', 'files/abc/sidecar', 'files/../evil/download', 'files']) {
      const res = await GET(ev(path));
      expect(res.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid session ids with 404', async () => {
    const res = await GET(ev('files/ab%2Fc/download'));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps upstream network failure to 502', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await GET(ev('files/abc/download'));
    expect(res.status).toBe(502);
  });

  it('passes through upstream error status and body', async () => {
    fetchMock.mockResolvedValueOnce(
      upstreamResponse('{"error":"session expired"}', { status: 404 })
    );
    const res = await GET(ev('files/abc/download'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'session expired' });
  });
});

describe('/api/metaclean without METADATA_CLEANER_URL', () => {
  it('returns 503 when unconfigured', async () => {
    vi.resetModules();
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const mod = await import('../../routes/api/metaclean/[...path]/+server.js');
    const res = await mod.GET(ev('files/abc/download'));
    expect(res.status).toBe(503);
  });
});
