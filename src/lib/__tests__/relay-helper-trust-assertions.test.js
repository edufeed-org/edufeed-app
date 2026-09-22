/**
 * relay-helper: trust assertion config + profile search observer accessors.
 * Provider keys and the observer may be configured as npub or hex; the
 * accessors always hand out hex, and anything unparsable is dropped so a
 * typo in .env cannot leak into a relay filter.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

const LAOC_NPUB = 'npub1r30l8j4vmppvq8w23umcyvd3vct4zmfpfkn4c7h2h057rmlfcrmq9xt9ma';
const LAOC_HEX = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';
const HOUSE = 'a64c7b8d9d89b9b399191c398002514c53cadf0712397a8ca0c36162813f4775';

const mockConfig = /** @type {any} */ ({
  fallbackRelays: [],
  profileSearchRelays: ['wss://tags.example/relay'],
  profileSearchObserver: LAOC_NPUB,
  trustAssertions: {
    relays: ['wss://scores.example', 'wss://scores.example'],
    providers: [HOUSE, LAOC_NPUB, 'garbage']
  }
});

vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: { gatedMode: false } }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: mockConfig }));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => [])
}));

const { getProfileSearchObserver, getTrustAssertionRelays, getTrustAssertionProviders } =
  await import('$lib/helpers/relay-helper.js');

describe('trust assertion + observer accessors', () => {
  it('getProfileSearchObserver normalises npub → hex and returns null when unset or invalid', () => {
    expect(getProfileSearchObserver()).toBe(LAOC_HEX);
    mockConfig.profileSearchObserver = 'nonsense';
    expect(getProfileSearchObserver()).toBeNull();
    mockConfig.profileSearchObserver = null;
    expect(getProfileSearchObserver()).toBeNull();
  });

  it('getTrustAssertionRelays dedupes and tolerates a missing block', () => {
    expect(getTrustAssertionRelays()).toEqual(['wss://scores.example']);
    const saved = mockConfig.trustAssertions;
    mockConfig.trustAssertions = undefined;
    expect(getTrustAssertionRelays()).toEqual([]);
    expect(getTrustAssertionProviders()).toEqual([]);
    mockConfig.trustAssertions = saved;
  });

  it('getTrustAssertionProviders returns hex keys only', () => {
    expect(getTrustAssertionProviders()).toEqual([HOUSE, LAOC_HEX]);
  });
});
