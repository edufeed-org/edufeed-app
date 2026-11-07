// @ts-nocheck
/**
 * Community-targeted content reaches the community's own relays without the
 * caller passing the community event: computePublishRelays derives the target
 * communities from the event's `h` tags. And every user-event fan-out
 * (publishToRelays: outbox replay, companions, membership copies) answers
 * NIP-42 AUTH per relay instead of parking in applesauce's waitForAuth.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const relayMocks = new Map();
const poolPublish = vi.fn(async () => []);

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  pool: { relay: (url) => relayMocks.get(url), publish: (...a) => poolPublish(...a) },
  eventStore: { add: vi.fn(), remove: vi.fn(), getReplaceable: vi.fn() }
}));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  uncacheEvent: vi.fn(async () => {}),
  recacheEvent: vi.fn(async () => {})
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPublishRelays: vi.fn(async () => ['wss://own-write/']),
  getPrimaryWriteRelay: vi.fn(() => null)
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => []),
  kindToAppRelayCategory: vi.fn(() => null)
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getFallbackRelays: vi.fn(() => []),
  getIdentityBroadcastRelays: vi.fn(() => []),
  getAllLookupRelays: vi.fn(() => [])
}));
vi.mock('$lib/services/member-relays.js', () => ({ getMemberRelays: vi.fn(async () => []) }));
vi.mock('$lib/helpers/community-publish-relays.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveCommunityPublishRelays: vi.fn(async (kind, pubkeys, given = []) =>
    pubkeys.length || given.length ? ['wss://community/'] : []
  )
}));

import { computePublishRelays, publishToRelays } from '$lib/services/publish-service.js';
import { resolveCommunityPublishRelays } from '$lib/helpers/community-publish-relays.js';

const AUTHOR = 'a'.repeat(64);
const COMMUNITY = 'c'.repeat(64);
const event = (tags) => ({
  id: '1'.repeat(64),
  kind: 30023,
  pubkey: AUTHOR,
  created_at: 1,
  tags,
  sig: '',
  content: ''
});

beforeEach(() => {
  vi.clearAllMocks();
  relayMocks.clear();
});

describe('computePublishRelays — h-tag community targets', () => {
  it('adds the community relays of an h-tagged event without a communityEvent', async () => {
    const relays = await computePublishRelays(event([['h', COMMUNITY]]), []);

    expect(resolveCommunityPublishRelays).toHaveBeenCalledWith(30023, [COMMUNITY], []);
    expect(relays).toEqual(['wss://own-write/', 'wss://community/']);
  });

  it('passes an explicit communityEvent along', async () => {
    const communityEvent = { kind: 10222, pubkey: COMMUNITY, tags: [] };
    await computePublishRelays(event([['h', COMMUNITY]]), [], { communityEvent });

    expect(resolveCommunityPublishRelays).toHaveBeenCalledWith(
      30023,
      [COMMUNITY],
      [communityEvent]
    );
  });

  it('ignores NIP-29 group ids in h tags', async () => {
    const relays = await computePublishRelays(
      event([['h', '0b8e2c4a-1f3d-4c5e-9a7b-123456789abc']]),
      []
    );
    expect(relays).toEqual(['wss://own-write/']);
  });
});

describe('publishToRelays — NIP-42 aware fan-out', () => {
  const okRelay = (url) => ({ url, publish: vi.fn(async () => ({ ok: true, from: url })) });

  it('publishes a plain user event relay by relay through the AUTH-answering path', async () => {
    relayMocks.set('wss://a/', okRelay('wss://a/'));
    relayMocks.set('wss://b/', okRelay('wss://b/'));

    const result = await publishToRelays(event([]), ['wss://a/', 'wss://b/']);

    expect(poolPublish).not.toHaveBeenCalled();
    expect(relayMocks.get('wss://a/').publish).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, successCount: 2 });
  });

  it('a relay that throws counts as a failure, not a rejected publish', async () => {
    relayMocks.set('wss://a/', okRelay('wss://a/'));
    relayMocks.set('wss://dead/', {
      url: 'wss://dead/',
      publish: vi.fn(async () => {
        throw new Error('connection refused');
      })
    });

    const result = await publishToRelays(event([]), ['wss://a/', 'wss://dead/']);

    expect(result.successCount).toBe(1);
    expect(result.results).toContainEqual(
      expect.objectContaining({ ok: false, from: 'wss://dead/' })
    );
  });

  it('auth: false keeps the plain pool fan-out (gift wraps must not AUTH as the sender)', async () => {
    poolPublish.mockResolvedValueOnce([{ ok: true, from: 'wss://a/' }]);

    await publishToRelays(event([]), ['wss://a/'], { auth: false });

    expect(poolPublish).toHaveBeenCalledTimes(1);
  });
});
