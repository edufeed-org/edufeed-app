/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchEvents = vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) }));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents, fetchOutbox: fetchEvents }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: {} }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getProfileLookupRelays: () => ['wss://lookup/'],
  getCalendarRelays: () => ['wss://cal/'],
  getEducationalRelays: () => ['wss://edu/'],
  getArticleRelays: () => ['wss://long/'],
  getAllLookupRelays: () => ['wss://all/'],
  getCommunikeyRelays: () => ['wss://ck/']
}));

const { startProfileFeedLoaders } = await import('$lib/loaders/profile-feed-loaders.js');

/** @returns {Array<[string[], any]>} */
const calls = () => /** @type {any} */ (fetchEvents.mock.calls);
const asksForPublications = () =>
  calls().some(([relays, f]) => relays.includes('wss://edu/') && f.kinds?.includes(30040));

describe('startProfileFeedLoaders: publications', () => {
  beforeEach(() => fetchEvents.mockClear());

  it('fetches kind 30040 from the educational relays for the profile page', () => {
    startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)], profileTabs: true });
    expect(asksForPublications()).toBe(true);
  });

  it('leaves the feeds (dashboard) without publications', () => {
    startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)] });
    expect(calls().some(([, f]) => f.kinds?.includes(30040))).toBe(false);
  });
});
