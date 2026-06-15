// @ts-nocheck
/**
 * DmRelayBanner — non-blocking post-login nudge shown when the DM-relay
 * self-check concludes the user has no kind 10050 DM relay list, so others
 * can't reliably message them.
 *
 * Visible ONLY when ALL hold:
 *  - an active user exists
 *  - getDmRelayCheckStatus() === 'absent' (settled, genuinely missing)
 *  - default DM relays are configured (otherwise nothing to recommend)
 *  - dm-relay-banner-dismissed:<pubkey> is not set
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { render, fireEvent } from '@testing-library/svelte';

const mockActiveUser = vi.hoisted(() => ({ value: null }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));

const mockStatus = vi.hoisted(() => ({ value: 'absent' }));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getDmRelayCheckStatus: () => mockStatus.value
}));

const mockDefaultRelays = vi.hoisted(() => ({ value: ['wss://dm.edufeed.org'] }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getDefaultDmRelays: () => mockDefaultRelays.value
}));

const mockEnsure = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/services/dm-relay-backfill.js', () => ({
  ensureDmRelayList: mockEnsure
}));

const mockGoto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto: mockGoto }));

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'dm_relay_banner_title',
      'dm_relay_banner_body',
      'dm_relay_banner_use_cta',
      'dm_relay_banner_customize_cta',
      'dm_relay_banner_dismiss',
      'common_dismiss'
    ].map((key) => [key, () => key])
  )
);

import DmRelayBanner from '../DmRelayBanner.svelte';
import { markDmRelayBannerDismissed } from '$lib/stores/dm-relay-flags.svelte.js';

const PUBKEY = 'a'.repeat(64);
const SEL = '[data-testid="dm-relay-banner"]';

function user() {
  return { type: 'nsec', pubkey: PUBKEY };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockActiveUser.value = user();
  mockStatus.value = 'absent';
  mockDefaultRelays.value = ['wss://dm.edufeed.org'];
});

describe('DmRelayBanner', () => {
  it('renders when the check settled as absent', () => {
    const { container } = render(DmRelayBanner);
    expect(container.querySelector(SEL)).not.toBeNull();
  });

  it('does NOT render when there is no active user', () => {
    mockActiveUser.value = null;
    const { container } = render(DmRelayBanner);
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('does NOT render while the check is still in progress', () => {
    mockStatus.value = 'checking';
    const { container } = render(DmRelayBanner);
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('does NOT render when the user already has a DM relay list', () => {
    mockStatus.value = 'present';
    const { container } = render(DmRelayBanner);
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('does NOT render when no default DM relays are configured', () => {
    mockDefaultRelays.value = [];
    const { container } = render(DmRelayBanner);
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('does NOT render when already dismissed for this pubkey', () => {
    localStorage.setItem(`dm-relay-banner-dismissed:${PUBKEY}`, '1');
    const { container } = render(DmRelayBanner);
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('clicking "use recommended" calls ensureDmRelayList', async () => {
    const { container } = render(DmRelayBanner);
    const btn = container.querySelector('[data-testid="dm-relay-banner-use"]');
    expect(btn).not.toBeNull();
    await fireEvent.click(/** @type {HTMLElement} */ (btn));
    expect(mockEnsure).toHaveBeenCalledTimes(1);
  });

  it('clicking customize navigates to the DM relay settings anchor', async () => {
    const { container } = render(DmRelayBanner);
    const btn = container.querySelector('[data-testid="dm-relay-banner-customize"]');
    expect(btn).not.toBeNull();
    await fireEvent.click(/** @type {HTMLElement} */ (btn));
    expect(mockGoto).toHaveBeenCalledWith('/settings#dm-relay-settings');
  });

  it('clicking dismiss persists the flag and hides the banner reactively', async () => {
    const { container } = render(DmRelayBanner);
    const btn = container.querySelector('[data-testid="dm-relay-banner-dismiss"]');
    expect(btn).not.toBeNull();
    await fireEvent.click(/** @type {HTMLElement} */ (btn));
    expect(localStorage.getItem(`dm-relay-banner-dismissed:${PUBKEY}`)).toBe('1');
    expect(container.querySelector(SEL)).toBeNull();
  });

  it('hides reactively when dismissed elsewhere (no reload needed)', async () => {
    const { container } = render(DmRelayBanner);
    expect(container.querySelector(SEL)).not.toBeNull();
    markDmRelayBannerDismissed(PUBKEY);
    await tick();
    expect(container.querySelector(SEL)).toBeNull();
  });
});
