/**
 * fetchCommunityCalendarEvents - URL d-tag coordinate parsing
 *
 * Regression test for "Shares: a-tag coordinates split on every colon,
 * breaking URL d-tags": a targeted-publication's 'a' tag coordinate whose
 * d-tag itself contains colons (e.g. a URL) must resolve with the FULL
 * d-tag, not just the text up to the first colon inside it.
 *
 * bufferTime() is swapped for toArray() so the test does not wait on the
 * function's real 2s/3s collection windows; both operators forward "all
 * values emitted by a completed source" to the next operator, so behaviour
 * for our single-shot mocked loaders is equivalent.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';

const PUBKEY = 'b'.repeat(64);
const URL_DTAG = 'https://example.org/e/1';
const COORDINATE = `31923:${PUBKEY}:${URL_DTAG}`;

const targetedPubEvent = {
  id: 'targeted-pub-1',
  kind: 30222,
  tags: [['a', COORDINATE]]
};

const loadedEvent = { id: 'loaded-event-1', kind: 31923, tags: [] };

const addressLoaderMock = vi.fn(() => of(loadedEvent));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: vi.fn(() => undefined),
    add: vi.fn()
  }
}));

vi.mock('$lib/loaders', () => ({
  communityCalendarTimelineLoader: vi.fn(() => of([])),
  communityTargetedPublicationsLoader: vi.fn(() => of([targetedPubEvent])),
  addressLoader: addressLoaderMock
}));

vi.mock('rxjs', async (importOriginal) => {
  const orig = /** @type {any} */ (await importOriginal());
  return {
    ...orig,
    // Collapse the real time-windowed buffer into "everything the source
    // emitted before completing" so the test resolves synchronously.
    bufferTime: () => orig.toArray()
  };
});

const { fetchCommunityCalendarEvents } = await import('../helpers/calendar.js');

describe('fetchCommunityCalendarEvents', () => {
  it('resolves a targeted-publication share whose d-tag contains colons', async () => {
    const result = await fetchCommunityCalendarEvents('community-pubkey', [
      'wss://test-relay.example'
    ]);

    expect(addressLoaderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 31923,
        pubkey: PUBKEY,
        identifier: URL_DTAG
      })
    );
    expect(result).toEqual([loadedEvent]);
  });
});
