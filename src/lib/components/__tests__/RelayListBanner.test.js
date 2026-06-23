/**
 * RelayListBanner — post-login nudge shown when the active user has no kind
 * 10002 NIP-65 relay list (or an empty one). "Use recommended" publishes the
 * default list via publishDefaultRelayList; the copy is nsec-aware so private-key
 * users understand they are signing directly. Only shows after the network load
 * settles, so it never fires over a list we just hadn't fetched yet.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { of } from 'rxjs';

vi.useFakeTimers();

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'relay_list_banner_title',
      'relay_list_banner_body',
      'relay_list_banner_body_nsec',
      'relay_list_banner_use_cta',
      'relay_list_banner_customize_cta',
      'relay_list_banner_dismiss'
    ].map((k) => [k, () => k])
  )
);

const mockGoto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto: mockGoto }));

const mockActiveUser = vi.hoisted(() => ({
  value: /** @type {any} */ ({ pubkey: 'abc', type: 'nsec' })
}));
const mockManager = vi.hoisted(() => ({ active: { signer: { signEvent: vi.fn() } } }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser.value,
  manager: mockManager
}));

const mockReplaceable = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore: { replaceable: mockReplaceable }
}));

vi.mock('$lib/loaders/relay-list-loader.js', () => ({
  createRelayListLoader: () => () => () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => []
}));

const mockGetDefaultRelayList = vi.hoisted(() => vi.fn(() => ['wss://a.example/']));
const mockHasMailboxRelays = vi.hoisted(() =>
  vi.fn((e) => !!e && (e.tags || []).some((/** @type {string[]} */ t) => t[0] === 'r'))
);
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getDefaultRelayList: mockGetDefaultRelayList,
  hasMailboxRelays: mockHasMailboxRelays
}));

const mockPublishDefault = vi.hoisted(() => vi.fn().mockResolvedValue({ kind: 10002 }));
vi.mock('$lib/services/relay-list-backfill.js', () => ({
  publishDefaultRelayList: mockPublishDefault
}));

const mockIsDismissed = vi.hoisted(() => vi.fn(() => false));
const mockMarkDismissed = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/relay-list-flags.svelte.js', () => ({
  isRelayListBannerDismissed: mockIsDismissed,
  markRelayListBannerDismissed: mockMarkDismissed
}));

import RelayListBanner from '../RelayListBanner.svelte';

describe('RelayListBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveUser.value = { pubkey: 'abc', type: 'nsec' };
    mockReplaceable.mockReturnValue(of(undefined));
    mockGetDefaultRelayList.mockReturnValue(['wss://a.example/']);
    mockIsDismissed.mockReturnValue(false);
  });

  it('does not show before the network load settles', () => {
    const { queryByTestId } = render(RelayListBanner);
    expect(queryByTestId('relay-list-banner')).toBeNull();
  });

  it('shows after settle when the user has no kind 10002', async () => {
    const { queryByTestId } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    expect(queryByTestId('relay-list-banner')).not.toBeNull();
  });

  it('shows the nsec-specific body for private-key accounts', async () => {
    const { getByText } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getByText('relay_list_banner_body_nsec')).toBeTruthy();
  });

  it('shows the generic body for extension accounts', async () => {
    mockActiveUser.value = { pubkey: 'abc', type: 'extension' };
    const { getByText } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    expect(getByText('relay_list_banner_body')).toBeTruthy();
  });

  it('hides when the user already has a non-empty 10002', async () => {
    mockReplaceable.mockReturnValue(of({ kind: 10002, tags: [['r', 'wss://a.example/']] }));
    const { queryByTestId } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    expect(queryByTestId('relay-list-banner')).toBeNull();
  });

  it('treats an empty 10002 as missing and shows', async () => {
    mockReplaceable.mockReturnValue(of({ kind: 10002, tags: [] }));
    const { queryByTestId } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    expect(queryByTestId('relay-list-banner')).not.toBeNull();
  });

  it('does not show when there are no default relays to recommend', async () => {
    mockGetDefaultRelayList.mockReturnValue([]);
    const { queryByTestId } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    expect(queryByTestId('relay-list-banner')).toBeNull();
  });

  it('"Use recommended" publishes the default relay list with the active signer', async () => {
    const { getByTestId } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    await fireEvent.click(getByTestId('relay-list-banner-use'));
    expect(mockPublishDefault).toHaveBeenCalledWith(mockManager.active.signer);
  });

  it('"Choose relays myself" navigates to settings', async () => {
    const { getByTestId } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    await fireEvent.click(getByTestId('relay-list-banner-customize'));
    expect(mockGoto).toHaveBeenCalledWith('/settings#relay-settings');
  });

  it('"Dismiss" marks the banner dismissed for the pubkey', async () => {
    const { getByTestId } = render(RelayListBanner);
    await vi.advanceTimersByTimeAsync(5000);
    await fireEvent.click(getByTestId('relay-list-banner-dismiss'));
    expect(mockMarkDismissed).toHaveBeenCalledWith('abc');
  });
});
