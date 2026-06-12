/**
 * ensureDmRelayList — backfills a kind 10050 DM relay list for users who
 * signed up before the signup-time default. Runs before an outgoing wrapped DM:
 * no-op when one already exists / no relays configured / no active user;
 * otherwise signs, locally adds, and publishes the default 10050.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetReplaceable = vi.hoisted(() => vi.fn());
const mockAdd = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    getReplaceable: mockGetReplaceable,
    add: mockAdd
  }
}));

const mockSignEvent = vi.hoisted(() => vi.fn(async (e) => ({ ...e, id: 'signed', sig: 'sig' })));
const mockManager = vi.hoisted(() => ({
  active: /** @type {any} */ ({ pubkey: 'me_hex', signer: { signEvent: mockSignEvent } })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));

const mockPublishEvent = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent: mockPublishEvent }));

const mockGetDefaultDmRelays = vi.hoisted(() => vi.fn(() => ['wss://dm.edufeed.org']));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getDefaultDmRelays: mockGetDefaultDmRelays }));

import { ensureDmRelayList } from '$lib/services/dm-relay-backfill.js';

describe('ensureDmRelayList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReplaceable.mockReturnValue(undefined);
    mockManager.active = { pubkey: 'me_hex', signer: { signEvent: mockSignEvent } };
    mockSignEvent.mockImplementation(async (e) => ({ ...e, id: 'signed', sig: 'sig' }));
    mockGetDefaultDmRelays.mockReturnValue(['wss://dm.edufeed.org']);
    mockPublishEvent.mockResolvedValue({ success: true });
  });

  it('signs, adds, and publishes a default kind 10050 when the user has none', async () => {
    await ensureDmRelayList();

    expect(mockGetReplaceable).toHaveBeenCalledWith(10050, 'me_hex');
    expect(mockSignEvent).toHaveBeenCalledTimes(1);
    const signedInput = mockSignEvent.mock.calls[0][0];
    expect(signedInput.kind).toBe(10050);
    expect(signedInput.tags).toEqual([['relay', 'wss://dm.edufeed.org']]);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the user already has a kind 10050', async () => {
    mockGetReplaceable.mockReturnValue({ kind: 10050, pubkey: 'me_hex', tags: [] });
    await ensureDmRelayList();

    expect(mockSignEvent).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when no default DM relays are configured', async () => {
    mockGetDefaultDmRelays.mockReturnValue([]);
    await ensureDmRelayList();

    expect(mockSignEvent).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no active user', async () => {
    mockManager.active = null;
    await ensureDmRelayList();

    expect(mockGetReplaceable).not.toHaveBeenCalled();
    expect(mockSignEvent).not.toHaveBeenCalled();
  });
});
