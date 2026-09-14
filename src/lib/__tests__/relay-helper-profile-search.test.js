/**
 * getProfileSearchRelays() — the NIP-50 capable relays ContactSearchInput's
 * `searchProfiles` mode queries for people outside the user's follows.
 * Configured via PROFILE_SEARCH_RELAYS; NOT unioned with the profile lookup
 * relays (strfry-based ones reject the `search` filter field outright).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

const mockConfig = /** @type {any} */ ({
  fallbackRelays: ['wss://fallback.example.com'],
  indexerRelays: ['wss://purplepag.es'],
  profileSearchRelays: [
    'wss://search-a.example.com',
    'wss://search-a.example.com',
    'wss://search-b.example.com'
  ]
});

vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: { gatedMode: false }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: mockConfig
}));

vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => [])
}));

const { getProfileSearchRelays } = await import('$lib/helpers/relay-helper.js');

describe('getProfileSearchRelays', () => {
  it('returns the configured search relays, deduplicated', () => {
    expect(getProfileSearchRelays()).toEqual([
      'wss://search-a.example.com',
      'wss://search-b.example.com'
    ]);
  });

  it('does not fall back to lookup or fallback relays (they reject NIP-50 filters)', () => {
    const relays = getProfileSearchRelays();
    expect(relays).not.toContain('wss://purplepag.es');
    expect(relays).not.toContain('wss://fallback.example.com');
  });

  it('returns an empty list when nothing is configured', () => {
    const saved = mockConfig.profileSearchRelays;
    mockConfig.profileSearchRelays = undefined;
    expect(getProfileSearchRelays()).toEqual([]);
    mockConfig.profileSearchRelays = saved;
  });
});
