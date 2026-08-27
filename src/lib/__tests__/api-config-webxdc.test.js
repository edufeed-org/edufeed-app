/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('/api/config webxdc block', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('defaults sandboxDomain to iframe.diy and curatedApps to []', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc).toEqual({ sandboxDomain: 'iframe.diy', curatedApps: [] });
  });

  it('uses SANDBOX_DOMAIN when set', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { SANDBOX_DOMAIN: 'sandbox.edufeed.org' } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.sandboxDomain).toBe('sandbox.edufeed.org');
  });

  const HASH64 = 'a'.repeat(64);
  const NEVENT =
    'nevent1qqsyz3fzge824jenrgcxg4nn0kqcphxjjmqvkgczfy9ee5ynxg8sr8spz3mhxue69uhk2mrgv46hguce';

  it('keeps a valid nevent entry', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { WEBXDC_APPS: NEVENT } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.curatedApps).toEqual([NEVENT]);
  });

  it('keeps a valid 64-hex entry and lowercases it', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { WEBXDC_APPS: HASH64.toUpperCase() } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.curatedApps).toEqual([HASH64]);
  });

  it('parses a comma-separated list, trims whitespace, and preserves order', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: { WEBXDC_APPS: ` ${NEVENT} , ${HASH64} ` }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.curatedApps).toEqual([NEVENT, HASH64]);
  });

  it('drops junk entries and warns, keeping valid ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock('$env/dynamic/private', () => ({
      env: { WEBXDC_APPS: `not-a-ref,${NEVENT},abc123` }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.curatedApps).toEqual([NEVENT]);
    expect(warn).toHaveBeenCalled();
  });

  it('is [] when WEBXDC_APPS is unset', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.curatedApps).toEqual([]);
  });

  it('is [] when WEBXDC_APPS is blank', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { WEBXDC_APPS: '   ' } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.webxdc.curatedApps).toEqual([]);
  });
});
