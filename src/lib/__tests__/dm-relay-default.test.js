/**
 * Tests for getDefaultDmRelays() — resolves the NIP-17 DM relay list a new
 * user should publish at signup: configured DM_RELAYS when present, otherwise
 * the general fallback relays.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAppSettings = { gatedMode: false };
const mockConfig = {
  fallbackRelays: ['wss://fallback1.example.com', 'wss://fallback2.example.com'],
  dmRelays: /** @type {string[] | undefined} */ (undefined)
};

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: mockAppSettings
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: mockConfig
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => [])
}));

const { getDefaultDmRelays } = await import('$lib/helpers/relay-helper.js');

describe('getDefaultDmRelays', () => {
  beforeEach(() => {
    mockAppSettings.gatedMode = false;
    mockConfig.dmRelays = undefined;
  });

  it('returns configured DM relays when present', () => {
    mockConfig.dmRelays = ['wss://dm.edufeed.org/'];
    expect(getDefaultDmRelays()).toEqual(['wss://dm.edufeed.org/']);
  });

  it('falls back to fallback relays when no DM relays configured', () => {
    mockConfig.dmRelays = [];
    expect(getDefaultDmRelays()).toEqual([
      'wss://fallback1.example.com',
      'wss://fallback2.example.com'
    ]);
  });

  it('falls back to fallback relays when dmRelays is undefined', () => {
    mockConfig.dmRelays = undefined;
    expect(getDefaultDmRelays()).toEqual([
      'wss://fallback1.example.com',
      'wss://fallback2.example.com'
    ]);
  });

  it('still returns fallback relays in gated mode (DM relays are an inbox, not a content source)', () => {
    // Gated mode strips fallback relays for *content* fetching, but DM relays
    // are where the user RECEIVES personal messages — blinding the inbox would
    // hide the "no DM relay" nudge and break delivery. Default must survive
    // gated mode even when DM_RELAYS is unset.
    mockAppSettings.gatedMode = true;
    mockConfig.dmRelays = undefined;
    expect(getDefaultDmRelays()).toEqual([
      'wss://fallback1.example.com',
      'wss://fallback2.example.com'
    ]);
  });
});
