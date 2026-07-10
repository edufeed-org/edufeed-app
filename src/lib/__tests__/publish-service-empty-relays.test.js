// @ts-nocheck
/**
 * publish-service empty-relay-set safety net (found verifying issue #36)
 *
 * A fresh account (no NIP-65 write relays) publishing a kind with no
 * app-relay category (e.g. kind 1 note, kind 1068 poll) and no community
 * produced an EMPTY relay set: publishEvent "published" to zero relays and
 * the event silently vanished. When the computed set is empty, fall back to
 * the deployment fallback relays.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const relayMocks = new Map();

vi.mock('$lib/stores/nostr-infrastructure.svelte.js', () => ({
  pool: { relay: (url) => relayMocks.get(url) },
  eventStore: { add: vi.fn(), remove: vi.fn() }
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPublishRelays: vi.fn(async () => []),
  getPrimaryWriteRelay: vi.fn(() => null)
}));
vi.mock('$lib/services/app-relay-service.svelte.js', () => ({
  getAppRelaysForCategory: vi.fn(() => []),
  kindToAppRelayCategory: vi.fn(() => null)
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getRelaysForKind: vi.fn(() => []),
  getCommunityGlobalRelays: vi.fn(() => []),
  getCommunityRelaysByEnforcement: vi.fn(() => ({ enforced: [], optional: [] }))
}));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getFallbackRelays: vi.fn(() => ['wss://fallback.example'])
}));

import { publishEvent } from '$lib/services/publish-service.js';

const NOTE = {
  id: '1'.repeat(64),
  kind: 1,
  pubkey: 'a'.repeat(64),
  tags: [],
  sig: '',
  content: 'hello'
};

describe('publishEvent empty relay set fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    relayMocks.clear();
  });

  it('falls back to the deployment fallback relays when no relay resolves', async () => {
    const publishSpy = vi.fn(async () => ({ ok: true, from: 'wss://fallback.example' }));
    relayMocks.set('wss://fallback.example', { publish: publishSpy });

    const result = await publishEvent(NOTE, []);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.relays).toEqual(['wss://fallback.example']);
  });

  it('does not add fallback relays when other relays resolved', async () => {
    const additionalSpy = vi.fn(async () => ({ ok: true }));
    const fallbackSpy = vi.fn(async () => ({ ok: true }));
    relayMocks.set('wss://explicit.example', { publish: additionalSpy });
    relayMocks.set('wss://fallback.example', { publish: fallbackSpy });

    const result = await publishEvent(NOTE, [], { additionalRelays: ['wss://explicit.example'] });

    expect(additionalSpy).toHaveBeenCalledTimes(1);
    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(result.relays).toEqual(['wss://explicit.example']);
  });
});
