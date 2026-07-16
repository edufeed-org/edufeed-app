/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('GET /api/config — npubLogin + googleLogin', () => {
  beforeEach(() => vi.resetModules());

  it('both features are disabled by default with public-infra defaults', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.npubLogin).toEqual({ enabled: false });
    expect(body.googleLogin).toEqual({
      enabled: false,
      centralUrl: 'https://auth.njump.me',
      operatorUrls: [
        'https://po.jumble.social',
        'https://po.coracle.social',
        'https://po.njump.me',
        'https://po.f7z.io',
        'https://po.nostrver.se'
      ]
    });
  });

  it('env vars enable the features and override server URLs', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: {
        NPUB_LOGIN_ENABLED: 'true',
        GOOGLE_LOGIN_ENABLED: 'true',
        POMEGRANATE_CENTRAL_URL: 'https://auth.example.org',
        POMEGRANATE_OPERATOR_URLS: 'https://op1.example.org, https://op2.example.org'
      }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.npubLogin.enabled).toBe(true);
    expect(body.googleLogin.enabled).toBe(true);
    expect(body.googleLogin.centralUrl).toBe('https://auth.example.org');
    expect(body.googleLogin.operatorUrls).toEqual([
      'https://op1.example.org',
      'https://op2.example.org'
    ]);
  });
});
