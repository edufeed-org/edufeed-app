/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchEvents = vi.fn(() => ({ subscribe: () => ({ unsubscribe() {} }) }));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents, fetchOutbox: fetchEvents }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: {} }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));
const getWriteRelays = vi.fn(async () => ['wss://own/']);
vi.mock('$lib/services/relay-service.svelte.js', () => ({ getWriteRelays }));
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

describe('startProfileFeedLoaders: profile page', () => {
  beforeEach(() => {
    fetchEvents.mockClear();
    getWriteRelays.mockClear();
  });

  it('fetches kind 30040 from the educational relays for the profile page', () => {
    startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)], profilePage: true });
    expect(asksForPublications()).toBe(true);
  });

  // Wikis (NIP-54) live wherever the author publishes them — the same
  // all-lookup set the /wiki/<topic> route reads.
  it('fetches kind 30818 from the lookup relays for the profile page', () => {
    startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)], profilePage: true });
    expect(
      calls().some(([relays, f]) => relays.includes('wss://all/') && f.kinds?.includes(30818))
    ).toBe(true);
  });

  it('leaves the feeds (dashboard) without wikis', () => {
    startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)] });
    expect(calls().some(([, f]) => f.kinds?.includes(30818))).toBe(false);
  });

  it('leaves the feeds (dashboard) without publications', () => {
    startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)] });
    expect(calls().some(([, f]) => f.kinds?.includes(30040))).toBe(false);
  });

  // Own content often lives only on the author's NIP-65 write relays (the
  // same leg "Meine Inhalte" has) — a cold profile otherwise misses it.
  it("also asks the author's write relays for every profile kind", async () => {
    startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)], profilePage: true });
    await vi.waitFor(() => expect(getWriteRelays).toHaveBeenCalledWith('a'.repeat(64)));
    await vi.waitFor(() =>
      expect(calls().some(([relays]) => relays.includes('wss://own/'))).toBe(true)
    );
    const [, filters] = /** @type {[string[], any]} */ (
      calls().find(([relays]) => relays.includes('wss://own/'))
    );
    const list = Array.isArray(filters) ? filters : [filters];
    for (const f of list) expect(f.authors).toEqual(['a'.repeat(64)]);
    const kinds = list.flatMap((f) => f.kinds);
    expect(kinds).toEqual(expect.arrayContaining([1, 30023, 30040, 30818, 39701, 1068, 6, 16]));
    // One limit per content group: an author's many notes must not push
    // older publications or articles out of a shared limit.
    const notes = list.find((f) => f.kinds.includes(1));
    expect(notes.kinds).not.toContain(30040);
    expect(notes.kinds).not.toContain(30023);
  });

  it('does not query write relays after the caller unsubscribed', async () => {
    const subs = startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)], profilePage: true });
    for (const sub of subs) sub.unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls().some(([relays]) => relays.includes('wss://own/'))).toBe(false);
  });

  it('leaves the dashboard feeds on their own relay sources', () => {
    startProfileFeedLoaders({ pubkeys: ['a'.repeat(64)] });
    expect(getWriteRelays).not.toHaveBeenCalled();
  });
});
