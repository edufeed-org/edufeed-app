/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted(() => ({ value: /** @type {Record<string, string>} */ ({}) }));
vi.doMock('$env/dynamic/private', () => ({
  get env() {
    return env.value;
  }
}));

async function call(origin = 'https://edufeed.example') {
  const { GET } = await import('../../routes/api/agent-config/+server.js');
  return GET({ url: new URL(origin + '/api/agent-config') });
}

describe('GET /api/agent-config', () => {
  beforeEach(() => {
    vi.resetModules();
    env.value = { APP_NAME: 'Edufeed', GROUPS_RELAYS: 'wss://groups.example' };
  });

  it('is 404 while agents are disabled', async () => {
    const res = await call();
    expect(res.status).toBe(404);
  });

  it('describes the deployment for the companion', async () => {
    env.value.AGENTS_ENABLED = 'true';
    env.value.AGENT_DOWNLOAD_URL = 'https://dl.example/agent.AppImage';
    const res = await call('https://edufeed.example');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      appName: 'Edufeed',
      appUrl: 'https://edufeed.example',
      groupsRelays: ['wss://groups.example'],
      pairingRelays: ['wss://groups.example'],
      downloadUrl: 'https://dl.example/agent.AppImage'
    });
  });
});
