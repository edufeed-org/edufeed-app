/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted(() => ({ value: /** @type {Record<string, string>} */ ({}) }));
vi.doMock('$env/dynamic/private', () => ({
  get env() {
    return env.value;
  }
}));

async function getConfig() {
  const { GET } = await import('../../routes/api/config/+server.js');
  return await GET().json();
}

describe('/api/config agents block', () => {
  beforeEach(() => {
    vi.resetModules();
    env.value = {};
  });

  it('is off by default with no pairing relays and no download url', async () => {
    env.value = { GROUPS_RELAYS: 'wss://groups.example' };
    const config = await getConfig();
    expect(config.agents).toEqual({
      enabled: false,
      pairingRelays: ['wss://groups.example'],
      downloadUrl: null
    });
  });

  it('reads AGENTS_ENABLED, AGENT_PAIRING_RELAYS and AGENT_DOWNLOAD_URL', async () => {
    env.value = {
      GROUPS_RELAYS: 'wss://groups.example',
      AGENTS_ENABLED: 'true',
      AGENT_PAIRING_RELAYS: 'wss://pair.example, wss://pair2.example',
      AGENT_DOWNLOAD_URL: 'https://example.org/edufeed-agent.AppImage'
    };
    const config = await getConfig();
    expect(config.agents).toEqual({
      enabled: true,
      pairingRelays: ['wss://pair.example', 'wss://pair2.example'],
      downloadUrl: 'https://example.org/edufeed-agent.AppImage'
    });
  });
});
