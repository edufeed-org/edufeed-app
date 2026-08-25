/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('/api/config webxdc block', () => {
  beforeEach(() => vi.resetModules());

  it('defaults sandboxDomain to iframe.diy', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc).toEqual({ sandboxDomain: 'iframe.diy', padApp: null });
  });

  it('uses SANDBOX_DOMAIN when set', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { SANDBOX_DOMAIN: 'sandbox.edufeed.org' } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.sandboxDomain).toBe('sandbox.edufeed.org');
  });

  const HASH64 = 'a'.repeat(64);

  it('builds padApp from PAD_APP_URL + a valid 64-hex PAD_APP_SHA256', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: { PAD_APP_URL: 'https://b/x.xdc', PAD_APP_SHA256: HASH64 }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.padApp).toEqual({
      url: 'https://b/x.xdc',
      sha256: HASH64,
      iconUrl: '',
      name: 'Pad'
    });
  });

  it('lowercases the sha256 and honors PAD_APP_ICON / PAD_APP_NAME', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: {
        PAD_APP_URL: 'https://b/x.xdc',
        PAD_APP_SHA256: HASH64.toUpperCase(),
        PAD_APP_ICON: 'https://b/icon.png',
        PAD_APP_NAME: 'Notizen'
      }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.padApp).toEqual({
      url: 'https://b/x.xdc',
      sha256: HASH64,
      iconUrl: 'https://b/icon.png',
      name: 'Notizen'
    });
  });

  it('is null when PAD_APP_URL is unset', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { PAD_APP_SHA256: HASH64 } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.padApp).toBeNull();
  });

  it('is null when PAD_APP_SHA256 has the wrong length', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: { PAD_APP_URL: 'https://b/x.xdc', PAD_APP_SHA256: 'abc' }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.padApp).toBeNull();
  });
});
