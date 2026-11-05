/**
 * toggleFollow must never replace a contact list it has not seen.
 *
 * applesauce's FollowUser waits 1 s for the user's kind 3 and otherwise
 * publishes a NEW list holding only the one contact — on a slow relay or a
 * fresh device that wiped hundreds of follows. A missing list is therefore
 * confirmed absent on the network first; 'unknown' refuses the follow.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ME = 'a'.repeat(64);
const THEM = 'b'.repeat(64);

const mockRun = vi.fn(async (/** @type {any[]} */ ..._args) => {});
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: (/** @type {any[]} */ ...a) => mockRun(...a) }
}));

const mockGetReplaceable = vi.fn();
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { getReplaceable: (/** @type {any[]} */ ...a) => mockGetReplaceable(...a) }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { active: { pubkey: 'a'.repeat(64) } }
}));

const mockProbe = vi.fn();
vi.mock('$lib/helpers/follow-set-probe.js', () => ({
  probeContactList: (/** @type {string} */ pk) => mockProbe(pk)
}));

const mockToast = vi.fn();
vi.mock('$lib/helpers/toast', () => ({
  showToast: (/** @type {any[]} */ ...a) => mockToast(...a)
}));

vi.mock('$lib/paraglide/messages.js', () => ({
  profile_follow_success: () => 'followed',
  profile_unfollow_success: () => 'unfollowed',
  profile_follow_error: () => 'error',
  profile_follow_list_unavailable: () => 'list unavailable'
}));

const { toggleFollow } = await import('$lib/helpers/follow.js');

beforeEach(() => {
  mockRun.mockClear();
  mockGetReplaceable.mockReset();
  mockProbe.mockReset();
  mockToast.mockClear();
});

describe('toggleFollow', () => {
  it('follows straight away when the contact list is already loaded', async () => {
    mockGetReplaceable.mockReturnValue({ kind: 3 });
    expect(await toggleFollow(THEM, false)).toBe(true);
    expect(mockProbe).not.toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('refuses when the network cannot confirm the list is absent', async () => {
    mockGetReplaceable.mockReturnValue(undefined);
    mockProbe.mockResolvedValue('unknown');
    expect(await toggleFollow(THEM, false)).toBe(false);
    expect(mockProbe).toHaveBeenCalledWith(ME);
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('list unavailable', 'error');
  });

  it('follows once the list was found on a relay', async () => {
    mockGetReplaceable.mockReturnValue(undefined);
    mockProbe.mockResolvedValue('found');
    expect(await toggleFollow(THEM, false)).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('creates a first list only when every write relay confirmed it is absent', async () => {
    mockGetReplaceable.mockReturnValue(undefined);
    mockProbe.mockResolvedValue('absent');
    expect(await toggleFollow(THEM, false)).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('guards unfollow the same way', async () => {
    mockGetReplaceable.mockReturnValue(undefined);
    mockProbe.mockResolvedValue('unknown');
    expect(await toggleFollow(THEM, true)).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
