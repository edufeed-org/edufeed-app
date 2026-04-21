/**
 * Community Targeted Publications Loader Tests
 *
 * Verifies that communityTargetedPublicationsLoader always uses communikey relays
 * (not content-specific relays like AMB or calendar relays), which is the core bug
 * this function was created to fix.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('applesauce-loaders/loaders', async (importOriginal) => {
  const actual = /** @type {Record<string, any>} */ (await importOriginal());
  return {
    ...actual,
    createTimelineLoader: vi.fn(() => vi.fn()),
    createAddressLoader: vi.fn(() => vi.fn()),
    createEventLoader: vi.fn(() => vi.fn())
  };
});

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { request: vi.fn() },
  eventStore: { add: vi.fn() }
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: vi.fn(() => ['wss://communikey-relay.example.com']),
  getAllLookupRelays: vi.fn(() => []),
  getEventLoaderLookupRelays: () => []
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { appRelays: {} }
}));

import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { communityTargetedPublicationsLoader } from '../loaders/targeted-publications.js';

describe('communityTargetedPublicationsLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses communikey relays, not content-specific relays', () => {
    const communityPubkey = 'abc123';
    communityTargetedPublicationsLoader(communityPubkey, [30142]);

    expect(getCommunikeyRelays).toHaveBeenCalled();
    expect(createTimelineLoader).toHaveBeenCalledWith(
      expect.anything(),
      ['wss://communikey-relay.example.com'],
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('passes correct filter with kind 30222 and community pubkey as #p', () => {
    const communityPubkey = 'abc123';
    communityTargetedPublicationsLoader(communityPubkey, [30142]);

    const filter = /** @type {any} */ (createTimelineLoader).mock.calls[0][2];
    expect(filter.kinds).toEqual([30222]);
    expect(filter['#p']).toEqual(['abc123']);
  });

  it('stringifies content kinds for #k filter', () => {
    communityTargetedPublicationsLoader('abc123', [30142]);
    const filter = /** @type {any} */ (createTimelineLoader).mock.calls[0][2];
    expect(filter['#k']).toEqual(['30142']);
  });

  it('handles multiple content kinds', () => {
    communityTargetedPublicationsLoader('abc123', [31922, 31923]);
    const filter = /** @type {any} */ (createTimelineLoader).mock.calls[0][2];
    expect(filter['#k']).toEqual(['31922', '31923']);
  });

  it('uses default limit of 100', () => {
    communityTargetedPublicationsLoader('abc123', [30142]);
    const opts = /** @type {any} */ (createTimelineLoader).mock.calls[0][3];
    expect(opts.limit).toBe(100);
  });

  it('accepts custom limit', () => {
    communityTargetedPublicationsLoader('abc123', [30142], 50);
    const opts = /** @type {any} */ (createTimelineLoader).mock.calls[0][3];
    expect(opts.limit).toBe(50);
  });

  it('passes eventStore to createTimelineLoader options', () => {
    communityTargetedPublicationsLoader('abc123', [30142]);
    const opts = /** @type {any} */ (createTimelineLoader).mock.calls[0][3];
    expect(opts.eventStore).toBeDefined();
  });
});
