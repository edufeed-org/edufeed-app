/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => vi.resetModules());

/**
 * @param {Record<string, string>} env
 */
async function getConfig(env) {
  vi.doMock('$env/dynamic/private', () => ({ env }));
  const { GET } = await import('../../routes/api/config/+server.js');
  const response = await GET();
  return response.json();
}

describe('/api/config discover.contentTypes', () => {
  it('defaults to every content type', async () => {
    const config = await getConfig({});
    expect(config.discover.contentTypes).toEqual([
      'events',
      'learning',
      'articles',
      'boards',
      'communities',
      'people'
    ]);
  });

  it('parses DISCOVER_CONTENT_TYPES, dropping unknown tokens', async () => {
    const config = await getConfig({ DISCOVER_CONTENT_TYPES: 'people, learning,bogus' });
    expect(config.discover.contentTypes).toEqual(['learning', 'people']);
  });
});
