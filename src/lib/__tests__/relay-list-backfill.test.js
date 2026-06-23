/**
 * relay-list-backfill — builds + publishes a default kind 10002 NIP-65 relay
 * list. buildSignedDefaultRelayList signs and returns the event (used by the
 * signup batch); publishDefaultRelayList also adds it to EventStore and
 * fire-and-forget publishes (used by the banner). No-op when no default relays.
 *
 * Uses the REAL applesauce EventFactory (no client tag) so the produced r-tags
 * are asserted for real, not mocked.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventFactory } from 'applesauce-core/event-factory';

// Real factory, no client tag (avoids config/app-settings store deps).
vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => new EventFactory()
}));

const mockGetDefaultRelayList = vi.hoisted(() =>
  vi.fn(() => ['wss://a.example/', 'wss://b.example/'])
);
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getDefaultRelayList: mockGetDefaultRelayList
}));

const mockAdd = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: mockAdd }
}));

const mockPublishEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: mockPublishEvent }));

import {
  buildSignedDefaultRelayList,
  publishDefaultRelayList
} from '$lib/services/relay-list-backfill.js';

const signer = {
  signEvent: vi.fn(async (t) => ({ ...t, pubkey: 'me_hex', id: 'signed', sig: 'sig' }))
};

describe('relay-list-backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultRelayList.mockReturnValue(['wss://a.example/', 'wss://b.example/']);
  });

  it('buildSignedDefaultRelayList builds a kind 10002 with bare r tags for each relay', async () => {
    const signed = await buildSignedDefaultRelayList(signer);
    expect(signed.kind).toBe(10002);
    const rTags = signed.tags.filter((t) => t[0] === 'r');
    expect(rTags).toHaveLength(2);
    const urls = rTags.map((t) => t[1]);
    expect(urls).toContain('wss://a.example/');
    expect(urls).toContain('wss://b.example/');
    // bare (read+write) — no marker
    expect(rTags.every((t) => t[2] === undefined)).toBe(true);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('buildSignedDefaultRelayList returns null when no default relays', async () => {
    mockGetDefaultRelayList.mockReturnValue([]);
    expect(await buildSignedDefaultRelayList(signer)).toBeNull();
    expect(signer.signEvent).not.toHaveBeenCalled();
  });

  it('publishDefaultRelayList adds to EventStore and publishes', async () => {
    const signed = await publishDefaultRelayList(signer);
    expect(signed.kind).toBe(10002);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(signed);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledWith(signed);
  });

  it('publishDefaultRelayList is a no-op when no default relays', async () => {
    mockGetDefaultRelayList.mockReturnValue([]);
    expect(await publishDefaultRelayList(signer)).toBeNull();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('publishDefaultRelayList swallows a signer rejection (e.g. user declines) and returns null', async () => {
    const rejectingSigner = { signEvent: vi.fn().mockRejectedValue(new Error('user declined')) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await publishDefaultRelayList(rejectingSigner)).toBeNull();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
