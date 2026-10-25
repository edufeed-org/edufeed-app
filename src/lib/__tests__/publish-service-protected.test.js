// @ts-nocheck
/**
 * NIP-70 protected events in the publish service (issue 10fc9681).
 *
 * A protected event (`["-"]` tag) may only be stored by a relay that checks
 * the author's NIP-42 AUTH. So its relay set is NOT the outbox fan-out:
 *
 *   - no tagged users' read relays and no identity broadcast relays — those
 *     are other people's relays, the author cannot authenticate there in any
 *     meaningful sense and most would refuse or silently drop it;
 *   - only relays whose NIP-11 advertises BOTH 42 and 70. relay.edufeed.org
 *     advertises 70 with AUTH switched off and then refuses every protected
 *     event ("blocked: event marked as protected"); relay.damus.io the same.
 *     A relay without 70 would accept it from anyone, which defeats the point.
 *
 * Every relay is still published to independently, so one slow AUTH (a
 * NIP-46 approval) never holds back the others.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const relayMocks = new Map();
const NIPS = new Map();

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  pool: { relay: (url) => relayMocks.get(url) },
  eventStore: { add: vi.fn(), remove: vi.fn(), getReplaceable: vi.fn() }
}));
vi.mock('$lib/stores/event-cache.svelte.js', () => ({
  uncacheEvent: vi.fn(async () => {}),
  recacheEvent: vi.fn(async () => {})
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPublishRelays: vi.fn(async (author, tagged = []) => [
    'wss://own-write/',
    'wss://own-plain/',
    ...tagged.map((p) => `wss://read-of-${p}/`)
  ]),
  getPrimaryWriteRelay: vi.fn(() => null)
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn((c) => (c === 'longform' ? ['wss://app-longform/'] : [])),
  kindToAppRelayCategory: vi.fn((k) => (k === 30023 ? 'longform' : null))
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getRelaysForKind: vi.fn(() => []),
  getCommunityGlobalRelays: vi.fn(() => []),
  getCommunityRelaysByEnforcement: vi.fn(() => ({ enforced: [], optional: [] }))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getFallbackRelays: vi.fn(() => ['wss://fallback-auth/', 'wss://fallback-plain/']),
  getIdentityBroadcastRelays: vi.fn(() => ['wss://indexer/'])
}));
vi.mock('$lib/services/relay-capabilities.js', () => ({
  relaySupportsNip: vi.fn(async (url, nip) => (NIPS.get(url) ?? []).includes(nip))
}));

import { computePublishRelays, publishEvent } from '$lib/services/publish-service.js';
import { getPublishRelays } from '$lib/services/relay-service.svelte.js';

const AUTHOR = 'a'.repeat(64);
const protectedNote = (extraTags = []) => ({
  id: '1'.repeat(64),
  kind: 1,
  pubkey: AUTHOR,
  created_at: 1,
  tags: [['-'], ...extraTags],
  sig: '',
  content: 'only on my relays'
});

beforeEach(() => {
  vi.clearAllMocks();
  relayMocks.clear();
  NIPS.clear();
  NIPS.set('wss://own-write/', [1, 42, 70]);
  NIPS.set('wss://own-plain/', [1, 70]); // advertises 70, AUTH off: refuses protected
  NIPS.set('wss://read-of-bob/', [1, 42, 70]);
  NIPS.set('wss://app-longform/', [1, 42, 70]);
  NIPS.set('wss://fallback-auth/', [1, 42, 70]);
  NIPS.set('wss://indexer/', [1, 42, 70]);
});

describe('computePublishRelays for a protected event', () => {
  it('keeps only the author-side relays that support NIP-42 and NIP-70', async () => {
    const relays = await computePublishRelays(protectedNote([['p', 'bob']]), ['bob']);
    expect(relays).toEqual(['wss://own-write/']);
    // Tagged users are not even asked for — their read relays are not ours.
    expect(getPublishRelays).toHaveBeenCalledWith(AUTHOR, []);
  });

  it('adds the app relays of the kind (articles → longform relay)', async () => {
    const article = { ...protectedNote(), kind: 30023 };
    const relays = await computePublishRelays(article, []);
    expect(relays).toEqual(['wss://own-write/', 'wss://app-longform/']);
  });

  it('does not use the fallback relays when the author has relays of their own', async () => {
    const relays = await computePublishRelays(protectedNote(), []);
    expect(relays).not.toContain('wss://fallback-auth/');
  });

  it('a fresh account without relays falls back to the deployment relays that can AUTH', async () => {
    getPublishRelays.mockResolvedValueOnce([]);
    const relays = await computePublishRelays(protectedNote(), []);
    expect(relays).toEqual(['wss://fallback-auth/']);
  });

  it('returns an empty set rather than spreading the event to relays that cannot protect it', async () => {
    NIPS.set('wss://own-write/', [1]);
    const relays = await computePublishRelays(protectedNote(), []);
    expect(relays).toEqual([]);
  });

  it('leaves unprotected events on the normal outbox path', async () => {
    const note = { ...protectedNote(), tags: [['p', 'bob']] };
    const relays = await computePublishRelays(note, ['bob']);
    expect(relays).toEqual(['wss://own-write/', 'wss://own-plain/', 'wss://read-of-bob/']);
  });
});

describe('publishEvent for a protected event', () => {
  it('reports which relays accepted it', async () => {
    relayMocks.set('wss://own-write/', {
      url: 'wss://own-write/',
      publish: vi.fn(async () => ({ ok: true, from: 'wss://own-write/' }))
    });
    const result = await publishEvent(protectedNote(), []);
    expect(result.success).toBe(true);
    expect(result.acceptedRelays).toEqual(['wss://own-write/']);
  });

  it('fails cleanly when no relay can take a protected event', async () => {
    NIPS.set('wss://own-write/', [1]);
    const result = await publishEvent(protectedNote(), []);
    expect(result.success).toBe(false);
    expect(result.relays).toEqual([]);
    expect(result.acceptedRelays).toEqual([]);
  });
});
