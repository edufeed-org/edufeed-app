// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fanOutMock = vi.fn();
vi.mock('$lib/server/oerFanout.js', () => ({
  fanOutOerSearch: (input) => fanOutMock(input)
}));

vi.mock('$env/dynamic/private', () => ({
  env: { OER_PROXY_URL: 'https://oer.proxy' }
}));

const { GET } = await import('../../routes/api/oer/+server.js');

/** Build a GET RequestEvent with query params. */
function ev(params) {
  const u = new URL('http://localhost/api/oer');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return { url: u };
}

describe('GET /api/oer', () => {
  beforeEach(() => fanOutMock.mockReset());

  it('returns 400 when searchTerm is missing', async () => {
    const res = await GET(ev({ sources: 'openverse' }));
    expect(res.status).toBe(400);
    expect(fanOutMock).not.toHaveBeenCalled();
  });

  it('locks type to image and forwards validated sources', async () => {
    fanOutMock.mockResolvedValueOnce({ data: [], meta: { hasMore: false } });
    const res = await GET(
      ev({ searchTerm: 'tree', sources: 'openverse,evil', type: 'video', page: 2 })
    );
    expect(res.status).toBe(200);
    const call = fanOutMock.mock.calls[0][0];
    expect(call.type).toBe('image');
    expect(call.sources).toEqual(['openverse']); // 'evil' dropped by allowlist
    expect(call.page).toBe(2);
    expect(call.baseUrl).toBe('https://oer.proxy');
  });

  it('returns the fan-out payload as JSON', async () => {
    const payload = {
      data: [{ id: 'a', amb: { id: 'https://x/y.jpg' } }],
      meta: { hasMore: true }
    };
    fanOutMock.mockResolvedValueOnce(payload);
    const res = await GET(ev({ searchTerm: 'tree', sources: 'openverse' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('returns 502 when fan-out throws', async () => {
    fanOutMock.mockRejectedValueOnce(new Error('boom'));
    const res = await GET(ev({ searchTerm: 'tree', sources: 'openverse' }));
    expect(res.status).toBe(502);
  });
});

describe('GET /api/oer without OER_PROXY_URL', () => {
  beforeEach(() => {
    fanOutMock.mockReset();
    vi.resetModules();
  });

  it('returns 503 when OER_PROXY_URL is unset', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    vi.doMock('$lib/server/oerFanout.js', () => ({ fanOutOerSearch: fanOutMock }));
    const { GET: GetNoEnv } = await import('../../routes/api/oer/+server.js');
    const u = new URL('http://localhost/api/oer');
    u.searchParams.set('searchTerm', 'tree');
    const res = await GetNoEnv({ url: u });
    expect(res.status).toBe(503);
    expect(fanOutMock).not.toHaveBeenCalled();
  });
});
