/**
 * GET /api/config — NIP-89 application handler discovery.
 *
 * Unknown event kinds get a generic detail view plus "open in another app"
 * links resolved from kind 31990 handler events. Where to look for those
 * and whether to offer them at all is deployment config, independent of
 * gated mode (laoc, 2026-10-09: "also allow when gated or make it a setting
 * per config").
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const DEFAULT_RELAYS = ['wss://relay.nostr.band', 'wss://nos.lol', 'wss://relay.damus.io'];

describe('GET /api/config — appHandlers', () => {
  beforeEach(() => vi.resetModules());

  it('is enabled by default and points at the well-known handler relays', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: {} }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.appHandlers).toEqual({ enabled: true, relays: DEFAULT_RELAYS });
  });

  it('APP_HANDLERS_ENABLED=false switches the feature off, APP_HANDLER_RELAYS overrides the list', async () => {
    vi.doMock('$env/dynamic/private', () => ({
      env: { APP_HANDLERS_ENABLED: 'false', APP_HANDLER_RELAYS: 'wss://a.example, wss://b.example' }
    }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.appHandlers).toEqual({
      enabled: false,
      relays: ['wss://a.example', 'wss://b.example']
    });
  });

  it('APP_HANDLER_RELAYS=none keeps the feature on but with no relays to ask', async () => {
    vi.doMock('$env/dynamic/private', () => ({ env: { APP_HANDLER_RELAYS: 'none' } }));
    const { GET } = await import('../../routes/api/config/+server.js');
    const body = await GET().json();
    expect(body.appHandlers).toEqual({ enabled: true, relays: [] });
  });
});

describe('getAppHandlerRelays (client side)', () => {
  beforeEach(() => vi.resetModules());

  it('returns the configured relays (deduped) even when gated mode is forced on', async () => {
    const { initializeConfig } = await import('$lib/stores/config.svelte.js');
    const { getAppHandlerRelays } = await import('$lib/helpers/relay-helper.js');
    initializeConfig({
      appHandlers: { enabled: true, relays: ['wss://a.example', 'wss://a.example'] },
      gatedMode: { default: true, force: true }
    });
    expect(getAppHandlerRelays()).toEqual(['wss://a.example']);
  });

  it('reports no relays while the feature is disabled', async () => {
    const { initializeConfig } = await import('$lib/stores/config.svelte.js');
    const { getAppHandlerRelays } = await import('$lib/helpers/relay-helper.js');
    initializeConfig({ appHandlers: { enabled: false, relays: ['wss://a.example'] } });
    expect(getAppHandlerRelays()).toEqual([]);
  });

  it('is empty when the server sent no appHandlers block (older server / tests)', async () => {
    const { initializeConfig } = await import('$lib/stores/config.svelte.js');
    const { getAppHandlerRelays } = await import('$lib/helpers/relay-helper.js');
    initializeConfig({});
    expect(getAppHandlerRelays()).toEqual([]);
  });
});
