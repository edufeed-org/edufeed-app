/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('GET /api/config — metadataCleaner.enabled', () => {
  beforeEach(() => vi.resetModules());

  it('metadataCleaner.enabled is true when METADATA_CLEANER_URL is set', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: { METADATA_CLEANER_URL: 'https://cleaner.example' }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.metadataCleaner).toEqual({ enabled: true });
  });

  it('metadataCleaner.enabled is false when METADATA_CLEANER_URL is unset', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.metadataCleaner).toEqual({ enabled: false });
  });
});
