/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('/api/config webxdc block', () => {
  beforeEach(() => vi.resetModules());

  it('defaults sandboxDomain to iframe.diy', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc).toEqual({ sandboxDomain: 'iframe.diy' });
  });

  it('uses SANDBOX_DOMAIN when set', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { SANDBOX_DOMAIN: 'sandbox.edufeed.org' } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.sandboxDomain).toBe('sandbox.edufeed.org');
  });
});
