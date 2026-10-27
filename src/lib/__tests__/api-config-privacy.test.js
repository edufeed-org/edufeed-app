/** @vitest-environment node */
// PRIVACY_POLICY_PATH → runtimeConfig.privacy.enabled: whether the deployment
// ships a privacy policy at /privacy. The path itself stays server-side; the
// client only learns whether to show the "Datenschutz" links.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @param {Record<string, string>} env */
async function configWith(env) {
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const { GET } = await import('../../routes/api/config/+server.js');
  return GET().json();
}

describe('GET /api/config — privacy', () => {
  beforeEach(() => vi.resetModules());

  it('is disabled when no policy file is configured', async () => {
    const body = await configWith({});
    expect(body.privacy).toEqual({ enabled: false });
  });

  it('is enabled when PRIVACY_POLICY_PATH names a file', async () => {
    const body = await configWith({ PRIVACY_POLICY_PATH: ' legal/privacy-policy.de.md ' });
    expect(body.privacy).toEqual({ enabled: true });
    expect(JSON.stringify(body)).not.toContain('legal/privacy-policy.de.md');
  });

  it('a blank path counts as unset', async () => {
    const body = await configWith({ PRIVACY_POLICY_PATH: '   ' });
    expect(body.privacy).toEqual({ enabled: false });
  });
});
