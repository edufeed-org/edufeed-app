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

describe('/api/config groups flag', () => {
  it('defaults groupsEnabled to false', async () => {
    const config = await getConfig({});
    expect(config.groupsEnabled).toBe(false);
  });

  it('parses GROUPS_ENABLED=true and keeps groupsRelays flat', async () => {
    const config = await getConfig({
      GROUPS_ENABLED: 'true',
      GROUPS_RELAYS: 'wss://groups.example.com'
    });
    expect(config.groupsEnabled).toBe(true);
    expect(config.groupsRelays).toEqual(['wss://groups.example.com']);
  });
});
