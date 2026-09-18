/**
 * getIdentityBroadcastRelays() — where a profile / relay list has to land so
 * the rest of the network can resolve the user.
 *
 * Deliberately NOT gated, for the same reason as getDefaultRelayList() and
 * getDefaultDmRelays(): a profile is identity infrastructure, not a content
 * feed. A gated deployment narrows what its users *read*; hiding their kind 0
 * from the indexes would only make them unresolvable everywhere else, which is
 * exactly the bug this exists to fix.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockAppSettings = { gatedMode: false };

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: mockAppSettings
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    fallbackRelays: ['wss://fallback1.example', 'wss://purplepag.es'],
    indexerRelays: ['wss://purplepag.es', 'wss://relay.edufeed.org'],
    relayListLookupRelays: ['wss://purplepag.es', 'wss://relay.damus.io']
  }
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => [])
}));

const { getIdentityBroadcastRelays } = await import('$lib/helpers/relay-helper.js');

describe('getIdentityBroadcastRelays', () => {
  beforeEach(() => {
    mockAppSettings.gatedMode = false;
  });

  it('unions indexer, relay-list-lookup and fallback relays', () => {
    expect(new Set(getIdentityBroadcastRelays())).toEqual(
      new Set([
        'wss://purplepag.es',
        'wss://relay.edufeed.org',
        'wss://relay.damus.io',
        'wss://fallback1.example'
      ])
    );
  });

  it('deduplicates relays that appear in several config lists', () => {
    const relays = getIdentityBroadcastRelays();
    expect(relays.filter((r) => r === 'wss://purplepag.es')).toHaveLength(1);
  });

  it('still returns the public relays when gated mode is ON', () => {
    mockAppSettings.gatedMode = true;
    const relays = getIdentityBroadcastRelays();
    expect(relays).toContain('wss://purplepag.es');
    expect(relays).toContain('wss://fallback1.example');
  });
});
