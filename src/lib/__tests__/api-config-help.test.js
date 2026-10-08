/** @vitest-environment node */
// HELP_URL → runtimeConfig.help.url: the target of the in-app "Hilfe" links
// (account menu, Termi chip, landing footer). Defaults to the user guide wiki
// article; `none` hides the links on deployments without a guide.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** @param {Record<string, string>} env */
async function configWith(env) {
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const { GET } = await import('../../routes/api/config/+server.js');
  return GET().json();
}

describe('GET /api/config — help', () => {
  beforeEach(() => vi.resetModules());

  it('defaults to the in-app "Erste Schritte" wiki article', async () => {
    const body = await configWith({});
    expect(body.help).toEqual({ url: '/wiki/edufeed-erste-schritte' });
  });

  it('HELP_URL overrides the target (external URLs allowed)', async () => {
    const body = await configWith({ HELP_URL: ' https://example.org/hilfe ' });
    expect(body.help.url).toBe('https://example.org/hilfe');
  });

  it('HELP_URL=none hides the help links', async () => {
    const body = await configWith({ HELP_URL: 'none' });
    expect(body.help).toEqual({ url: null });
  });

  it('a blank HELP_URL falls back to the default', async () => {
    const body = await configWith({ HELP_URL: '   ' });
    expect(body.help.url).toBe('/wiki/edufeed-erste-schritte');
  });
});
