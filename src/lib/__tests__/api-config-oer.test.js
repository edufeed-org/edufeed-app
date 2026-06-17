/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('GET /api/config — oer.enabled', () => {
  beforeEach(() => vi.resetModules());

  it('oer.enabled is true when OER_PROXY_URL is set', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { OER_PROXY_URL: 'https://oer.proxy' } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.oer).toEqual({ enabled: true });
  });

  it('oer.enabled is false when OER_PROXY_URL is unset', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.oer).toEqual({ enabled: false });
  });
});
