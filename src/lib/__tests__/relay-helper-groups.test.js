/**
 * Tests for getGroupsRelays() — NIP-29 group host relays.
 * Deliberately NO fallback union: empty means deployment ships no default.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfig = {
  runtimeConfig: {
    appRelays: {
      groups: []
    }
  }
};

vi.mock('$lib/stores/config.svelte.js', () => mockConfig);
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { gatedMode: false }
}));

const { getGroupsRelays } = await import('$lib/helpers/relay-helper.js');

describe('getGroupsRelays', () => {
  beforeEach(() => {
    mockConfig.runtimeConfig.appRelays = { groups: [] };
  });

  it('returns the configured groups relays verbatim', () => {
    mockConfig.runtimeConfig.appRelays.groups = ['wss://groups.example/'];
    expect(getGroupsRelays()).toEqual(['wss://groups.example/']);
  });

  it('returns [] when groups relays unset', () => {
    mockConfig.runtimeConfig.appRelays.groups = [];
    expect(getGroupsRelays()).toEqual([]);
  });

  it('returns [] when appRelays is undefined', () => {
    mockConfig.runtimeConfig.appRelays = undefined;
    expect(getGroupsRelays()).toEqual([]);
  });
});
