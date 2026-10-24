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
import { of } from 'rxjs';

vi.mock('$lib/loaders/base.js', () => ({
  fetchEvents: vi.fn(() => of())
}));

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getCommunikeyRelays: vi.fn(() => ['wss://communikey-relay.example.com'])
}));

import { fetchEvents } from '$lib/loaders/base.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { communityTargetedPublicationsLoader } from '../loaders/targeted-publications.js';

const filterOf = () => /** @type {any} */ (fetchEvents).mock.calls[0][1];

describe('communityTargetedPublicationsLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses communikey relays, not content-specific relays', () => {
    communityTargetedPublicationsLoader('abc123', [30142]);

    expect(getCommunikeyRelays).toHaveBeenCalled();
    expect(fetchEvents).toHaveBeenCalledWith(
      ['wss://communikey-relay.example.com'],
      expect.any(Object),
      { cache: true }
    );
  });

  it('passes correct filter with kind 30222 and community pubkey as #p', () => {
    communityTargetedPublicationsLoader('abc123', [30142]);
    expect(filterOf().kinds).toEqual([30222]);
    expect(filterOf()['#p']).toEqual(['abc123']);
  });

  it('stringifies content kinds for #k filter', () => {
    communityTargetedPublicationsLoader('abc123', [30142]);
    expect(filterOf()['#k']).toEqual(['30142']);
  });

  it('handles multiple content kinds', () => {
    communityTargetedPublicationsLoader('abc123', [31922, 31923]);
    expect(filterOf()['#k']).toEqual(['31922', '31923']);
  });

  it('uses default limit of 100', () => {
    communityTargetedPublicationsLoader('abc123', [30142]);
    expect(filterOf().limit).toBe(100);
  });

  it('accepts custom limit', () => {
    communityTargetedPublicationsLoader('abc123', [30142], 50);
    expect(filterOf().limit).toBe(50);
  });

  it('returns the request observable itself (one-shot, no loader function)', () => {
    const result = communityTargetedPublicationsLoader('abc123', [30142]);
    expect(typeof result.subscribe).toBe('function');
  });
});
