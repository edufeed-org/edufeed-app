/**
 * Tests for getAllLookupRelays() — verifies fallback relays are always
 * included for targeted event resolution, regardless of gated mode.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAppSettings = { gatedMode: false };

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: mockAppSettings
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    fallbackRelays: ['wss://fallback1.example.com', 'wss://fallback2.example.com'],
    indexerRelays: ['wss://purplepag.es']
  }
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn((/** @type {string} */ category) => {
    const map = /** @type {Record<string, string[]>} */ ({
      calendar: ['wss://cal.example.com'],
      communikey: ['wss://comm.example.com'],
      educational: [],
      longform: [],
      kanban: []
    });
    return map[category] || [];
  })
}));

const { getAllLookupRelays, getFallbackRelays, getEventLoaderLookupRelays } = await import(
  '$lib/helpers/relay-helper.js'
);

describe('getAllLookupRelays', () => {
  beforeEach(() => {
    mockAppSettings.gatedMode = false;
  });

  it('includes fallback relays when gated mode is OFF', () => {
    const relays = getAllLookupRelays();
    expect(relays).toContain('wss://fallback1.example.com');
    expect(relays).toContain('wss://fallback2.example.com');
    expect(relays).toContain('wss://cal.example.com');
  });

  it('includes fallback relays when gated mode is ON', () => {
    mockAppSettings.gatedMode = true;
    const relays = getAllLookupRelays();
    expect(relays).toContain('wss://fallback1.example.com');
    expect(relays).toContain('wss://fallback2.example.com');
    expect(relays).toContain('wss://cal.example.com');
  });

  it('getFallbackRelays returns empty when gated mode is ON (for feeds)', () => {
    mockAppSettings.gatedMode = true;
    expect(getFallbackRelays()).toEqual([]);
  });

  it('getFallbackRelays returns fallback relays when gated mode is OFF', () => {
    expect(getFallbackRelays()).toEqual([
      'wss://fallback1.example.com',
      'wss://fallback2.example.com'
    ]);
  });
});

describe('getEventLoaderLookupRelays', () => {
  beforeEach(() => {
    mockAppSettings.gatedMode = false;
  });

  it('includes indexer relays so auto-loaded profiles can resolve via profile indexers', () => {
    const relays = getEventLoaderLookupRelays();
    expect(relays).toContain('wss://purplepag.es');
  });

  it('includes indexer relays even when gated mode is ON', () => {
    mockAppSettings.gatedMode = true;
    const relays = getEventLoaderLookupRelays();
    expect(relays).toContain('wss://purplepag.es');
  });

  it('still includes app relays for content lookups', () => {
    const relays = getEventLoaderLookupRelays();
    expect(relays).toContain('wss://cal.example.com');
    expect(relays).toContain('wss://comm.example.com');
  });
});
