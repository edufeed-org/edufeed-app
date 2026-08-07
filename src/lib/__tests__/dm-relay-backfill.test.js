/**
 * ensureDmRelayList — gives a user a kind 10050 DM relay list when, and only
 * when, we have proved they have none.
 *
 * A kind 10050 is replaceable: publishing one over a list the user really has
 * destroys it. The EventStore alone cannot tell "this user has no DM relay
 * list" from "we have not fetched it yet", so this waits for the DM service's
 * settle-aware verdict and writes only on a conclusive 'absent'.
 *
 * Two further lines of defence, in case the proof is ever wrong: the store is
 * re-read at write time, and the write goes through applesauce's
 * AddDirectMessageRelay, which merges into an existing list rather than
 * replacing it. Neither is a substitute for the proof — AddDirectMessageRelay
 * decides via the same EventStore read with a 1s grace window — but together
 * they degrade the worst case from "your list is gone" to "a relay was added".
 *
 * The write is invisible to the user, so it is announced afterwards.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetReplaceable = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { getReplaceable: mockGetReplaceable }
}));

const mockManager = vi.hoisted(() => ({
  active: /** @type {any} */ ({ pubkey: 'me_hex', signer: { signEvent: vi.fn() } })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));

const mockGetDefaultDmRelays = vi.hoisted(() => vi.fn(() => ['wss://dm.edufeed.org']));
vi.mock('$lib/helpers/relay-helper.js', () => ({ getDefaultDmRelays: mockGetDefaultDmRelays }));

const mockWaitForDmRelayCheck = vi.hoisted(() => vi.fn(async () => 'absent'));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  waitForDmRelayCheck: mockWaitForDmRelayCheck
}));

const mockRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({ actionRunner: { run: mockRun } }));

const AddDirectMessageRelay = vi.hoisted(() => ({ __action: 'AddDirectMessageRelay' }));
vi.mock('applesauce-actions/actions', () => ({ AddDirectMessageRelay }));

const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock('$lib/helpers/toast.js', () => ({ showToast: mockShowToast }));

vi.mock('$lib/paraglide/messages', () => ({
  dm_relay_autosetup_notice: () => 'dm_relay_autosetup_notice'
}));

import { ensureDmRelayList } from '$lib/services/dm-relay-backfill.js';

/** @param {string[]} relayUrls */
function dmRelayList(relayUrls) {
  return { kind: 10050, pubkey: 'me_hex', tags: relayUrls.map((r) => ['relay', r]) };
}

describe('ensureDmRelayList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReplaceable.mockReturnValue(undefined);
    mockManager.active = { pubkey: 'me_hex', signer: { signEvent: vi.fn() } };
    mockGetDefaultDmRelays.mockReturnValue(['wss://dm.edufeed.org']);
    mockWaitForDmRelayCheck.mockResolvedValue('absent');
    mockRun.mockResolvedValue(undefined);
  });

  it('publishes the default DM relays once absence is proven', async () => {
    await ensureDmRelayList();

    expect(mockRun).toHaveBeenCalledWith(AddDirectMessageRelay, ['wss://dm.edufeed.org']);
  });

  it('waits for the check to conclude instead of reading a snapshot', async () => {
    await ensureDmRelayList();

    expect(mockWaitForDmRelayCheck).toHaveBeenCalledTimes(1);
    expect(mockWaitForDmRelayCheck.mock.invocationCallOrder[0]).toBeLessThan(
      mockRun.mock.invocationCallOrder[0]
    );
  });

  it('does not write when the user already has a DM relay list', async () => {
    mockWaitForDmRelayCheck.mockResolvedValue('present');
    await ensureDmRelayList();

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does not write when the check never reached a conclusion', async () => {
    // 'checking' means we asked and got no answer in time — the exact case
    // where publishing would supersede a list we simply had not seen.
    mockWaitForDmRelayCheck.mockResolvedValue('checking');
    await ensureDmRelayList();

    expect(mockRun).not.toHaveBeenCalled();
  });

  it('does not write when there is no session to conclude anything about', async () => {
    mockWaitForDmRelayCheck.mockResolvedValue('idle');
    await ensureDmRelayList();

    expect(mockRun).not.toHaveBeenCalled();
  });

  it('re-reads the store at write time, in case a list landed after the verdict', async () => {
    mockGetReplaceable.mockReturnValue(dmRelayList(['wss://theirs.example/']));
    await ensureDmRelayList();

    expect(mockGetReplaceable).toHaveBeenCalledWith(10050, 'me_hex');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('writes when the existing kind 10050 lists no relays at all', async () => {
    // An empty 10050 (e.g. after removing the last relay) leaves the user
    // unreachable, and is proof in itself — an existence-only guard would
    // wrongly skip it and the nudge would never clear.
    mockGetReplaceable.mockReturnValue(dmRelayList([]));
    await ensureDmRelayList();

    expect(mockRun).toHaveBeenCalledWith(AddDirectMessageRelay, ['wss://dm.edufeed.org']);
  });

  it('does not even wait when no default DM relays are configured', async () => {
    mockGetDefaultDmRelays.mockReturnValue([]);
    await ensureDmRelayList();

    expect(mockWaitForDmRelayCheck).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no active user', async () => {
    mockManager.active = null;
    await ensureDmRelayList();

    expect(mockWaitForDmRelayCheck).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('is a no-op for a read-only account with no signer', async () => {
    mockManager.active = { pubkey: 'me_hex', signer: null };
    await ensureDmRelayList();

    expect(mockRun).not.toHaveBeenCalled();
  });

  it('tells the user afterwards that an inbox was set up for them', async () => {
    await ensureDmRelayList();

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast.mock.calls[0][0]).toBe('dm_relay_autosetup_notice');
  });

  it('stays quiet when the caller already has its own feedback', async () => {
    // The assistant hint's "use recommended" tap flips the card to done; a
    // toast saying we did it for them would misdescribe their own action.
    await ensureDmRelayList({ announce: false });

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does not claim success when no relay accepted the list', async () => {
    mockRun.mockRejectedValue(new Error('Failed to publish event to any relay'));
    await expect(ensureDmRelayList()).resolves.toBeUndefined();

    expect(mockShowToast).not.toHaveBeenCalled();
  });
});
