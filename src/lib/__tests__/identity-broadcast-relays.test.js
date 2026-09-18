// @ts-nocheck
/**
 * Identity events (kind 0/3/10002/10050/10063) must not be confined to the
 * author's NIP-65 write relays.
 *
 * Measured on the live network 2026-09-18 for
 * npub10gyagq3eev0vcnqks69gewz22kvpe2989c5zua88huarjwwl04dq: a third-party
 * client had rewritten the user's kind 10002 down to a single relay, so the
 * kind 0 edufeed published afterwards existed on exactly ONE relay in the
 * world. purplepag.es — the profile index most clients read — still served a
 * months-old version, and clients that found nothing showed their own
 * placeholder, which the user then "fixed" by retyping into an empty form,
 * losing the name we had set.
 *
 * NIP-65 asks clients to spread relay lists "to as many relays as viable,
 * paying attention to relays that ... serve as well-known public indexers";
 * Amethyst broadcasts kind 0 / kind 10002 to its indexer list plus every
 * relay it knows (EventBroadcaster: `MetadataEvent || AdvertisedRelayListEvent`
 * → "everywhere").
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const IDENTITY_RELAYS = ['wss://purplepag.es', 'wss://fallback.example'];

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  pool: { relay: vi.fn() },
  eventStore: { add: vi.fn(), remove: vi.fn(), getReplaceable: vi.fn() }
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPublishRelays: vi.fn(async () => ['wss://own-write.example']),
  getPrimaryWriteRelay: vi.fn(() => null)
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => ['wss://app.example']),
  kindToAppRelayCategory: vi.fn((kind) => (kind === 30142 ? 'educational' : null))
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getRelaysForKind: vi.fn(() => []),
  getCommunityGlobalRelays: vi.fn(() => []),
  getCommunityRelaysByEnforcement: vi.fn(() => ({ enforced: [], optional: [] }))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getFallbackRelays: vi.fn(() => []),
  getIdentityBroadcastRelays: vi.fn(() => IDENTITY_RELAYS)
}));

const { computePublishRelays } = await import('$lib/services/publish-service.js');
const { isIdentityKind } = await import('$lib/helpers/identity-kinds.js');

/** @param {number} kind */
const ev = (kind) => ({
  id: '1'.repeat(64),
  kind,
  pubkey: 'a'.repeat(64),
  tags: [],
  content: '',
  sig: ''
});

describe('isIdentityKind', () => {
  it('covers the kinds that describe who a user is and where to reach them', () => {
    for (const kind of [0, 3, 10002, 10050, 10063]) {
      expect(isIdentityKind(kind)).toBe(true);
    }
  });

  it('excludes content kinds', () => {
    for (const kind of [1, 1059, 9, 30023, 30142, 31923, 10015, 10222]) {
      expect(isIdentityKind(kind)).toBe(false);
    }
  });
});

describe('computePublishRelays for identity kinds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds the identity broadcast relays to a kind 0 publish', async () => {
    const relays = await computePublishRelays(ev(0), []);
    expect(relays).toContain('wss://own-write.example');
    for (const r of IDENTITY_RELAYS) expect(relays).toContain(r);
  });

  it.each([3, 10002, 10050, 10063])('adds them for kind %i too', async (kind) => {
    const relays = await computePublishRelays(ev(kind), []);
    for (const r of IDENTITY_RELAYS) expect(relays).toContain(r);
  });

  it('leaves content kinds on the outbox + app relay set', async () => {
    const relays = await computePublishRelays(ev(30142), []);
    expect(relays).toEqual(['wss://own-write.example', 'wss://app.example']);
  });

  it('does not duplicate a relay that is already in the outbox set', async () => {
    const { getPublishRelays } = await import('$lib/services/relay-service.svelte.js');
    getPublishRelays.mockResolvedValueOnce(['wss://purplepag.es']);
    const relays = await computePublishRelays(ev(0), []);
    expect(relays.filter((r) => r === 'wss://purplepag.es')).toHaveLength(1);
  });
});
