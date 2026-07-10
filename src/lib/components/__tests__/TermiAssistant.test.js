// @ts-nocheck
/**
 * TermiAssistant — the chat assistant that carries the account-setup hints
 * formerly shown as info banners (backup file, NIP-65 relay list, kind 10050
 * DM relays). Ports the behavior matrix of the old banner tests:
 *
 *  - backup hint only for in-app-signup nsec accounts, hidden by the
 *    downloaded/dismissed flags, reactive "done" after markBackupDownloaded
 *  - relays hint only after the network check settles; primary action
 *    publishes the default list, secondary routes to settings
 *  - dm hint from the dm-service self-check; primary action backfills
 *  - launcher badge counts open hints
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick, flushSync } from 'svelte';
import { render, fireEvent } from '@testing-library/svelte';

// Message catalog: echo the key (params ignored).
vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'termi_launcher_aria',
      'termi_header_sub',
      'termi_expand_aria',
      'termi_collapse_aria',
      'termi_greeting',
      'termi_greeting_named',
      'termi_greeting_hint_one',
      'termi_greeting_hint_many',
      'termi_hint_done_chip',
      'termi_hint_relays_doing',
      'termi_hint_dm_doing',
      'termi_hint_nip05_title',
      'termi_hint_nip05_body',
      'termi_hint_nip05_cta',
      'termi_sugg_1_q',
      'termi_sugg_1_a',
      'termi_sugg_2_q',
      'termi_sugg_2_a',
      'termi_sugg_3_q',
      'termi_sugg_3_a',
      'termi_fallback',
      'termi_static_notice',
      'termi_input_placeholder',
      'termi_input_aria',
      'termi_send_aria',
      'aria_close_modal',
      'auth_backup_banner_title',
      'auth_backup_banner_body',
      'auth_backup_banner_download_cta',
      'relay_list_banner_title',
      'relay_list_banner_body',
      'relay_list_banner_body_nsec',
      'relay_list_banner_use_cta',
      'relay_list_banner_customize_cta',
      'dm_relay_banner_title',
      'dm_relay_banner_body',
      'dm_relay_banner_use_cta',
      'dm_relay_banner_customize_cta'
    ].map((key) => [key, () => key])
  )
);

const mockGoto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto: mockGoto }));

const mockActiveUser = vi.hoisted(() => ({ value: null }));
const mockManager = vi.hoisted(() => ({ active: { signer: { signEvent: vi.fn() } } }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser.value,
  manager: mockManager
}));

const mockModalStore = vi.hoisted(() => ({ openModal: vi.fn(), closeModal: vi.fn() }));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

// Relay-list check plumbing: the replaceable subscription emits mockRelayListEvent.
const mockRelayListEvent = vi.hoisted(() => ({ value: null }));
const mockProfileEvent = vi.hoisted(() => ({ value: null }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore: {
    replaceable: (kind) => ({
      subscribe: (cb) => {
        cb(kind === 0 ? mockProfileEvent.value : mockRelayListEvent.value);
        return { unsubscribe: vi.fn() };
      }
    })
  }
}));
vi.mock('$lib/loaders/relay-list-loader.js', () => ({
  createRelayListLoader: () => () => () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => []
}));

const mockDefaultRelays = vi.hoisted(() => ({ value: ['wss://a.example/'] }));
const mockDefaultDmRelays = vi.hoisted(() => ({ value: ['wss://dm.example/'] }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getDefaultRelayList: () => mockDefaultRelays.value,
  getDefaultDmRelays: () => mockDefaultDmRelays.value,
  hasMailboxRelays: (e) => !!e && (e.tags || []).some((t) => t[0] === 'r')
}));

const mockPublishDefault = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock('$lib/services/relay-list-backfill.js', () => ({
  publishDefaultRelayList: mockPublishDefault
}));
const mockEnsureDm = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock('$lib/services/dm-relay-backfill.js', () => ({ ensureDmRelayList: mockEnsureDm }));

const mockDmStatus = vi.hoisted(() => ({ value: 'idle' }));
vi.mock('$lib/services/dm-service.svelte.js', () => ({
  getDmRelayCheckStatus: () => mockDmStatus.value
}));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({ useUserProfile: () => () => null }));

const mockMembership = vi.hoisted(() => ({ value: { enabled: false, handleDomain: '' } }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return mockMembership.value;
    }
  }
}));

import TermiAssistant from '../assistant/TermiAssistant.svelte';
import { markBackupDownloaded } from '$lib/stores/backup-flags.svelte.js';

const NSEC_PUBKEY = 'a'.repeat(64);
const EXT_PUBKEY = 'b'.repeat(64);

function signedUpNsecUser() {
  localStorage.setItem(`signed-up-here:${NSEC_PUBKEY}`, '1');
  return { type: 'nsec', pubkey: NSEC_PUBKEY };
}

async function openTermi(container) {
  await fireEvent.click(container.querySelector('[data-testid="termi-launcher"]'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  mockActiveUser.value = null;
  mockRelayListEvent.value = { tags: [['r', 'wss://a.example/']] }; // relay list present
  mockDmStatus.value = 'present';
  mockMembership.value = { enabled: false, handleDomain: '' };
  mockProfileEvent.value = {
    kind: 0,
    content: JSON.stringify({ nip05: 'me@edufeed.org' }),
    tags: []
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TermiAssistant launcher + hints', () => {
  it('shows the backup hint for an in-app-signup nsec account', async () => {
    mockActiveUser.value = signedUpNsecUser();
    const { container } = render(TermiAssistant);
    expect(container.querySelector('[data-testid="termi-badge"]')?.textContent.trim()).toBe('1');

    await openTermi(container);
    expect(container.querySelector('[data-testid="termi-hint-backup"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="termi-hint-relays"]')).toBeNull();
    expect(container.querySelector('[data-testid="termi-hint-dm"]')).toBeNull();
  });

  it('shows no backup hint for extension accounts or downloaded/dismissed flags', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    const { container, unmount } = render(TermiAssistant);
    await openTermi(container);
    expect(container.querySelector('[data-testid="termi-hint-backup"]')).toBeNull();
    unmount();

    for (const flag of ['backup-downloaded', 'backup-banner-dismissed']) {
      mockActiveUser.value = signedUpNsecUser();
      localStorage.setItem(`${flag}:${NSEC_PUBKEY}`, '1');
      const r = render(TermiAssistant);
      await openTermi(r.container);
      expect(r.container.querySelector('[data-testid="termi-hint-backup"]')).toBeNull();
      r.unmount();
      localStorage.clear();
    }
  });

  it('backup action opens the recovery modal; hint flips to done when the flag lands', async () => {
    mockActiveUser.value = signedUpNsecUser();
    const { container } = render(TermiAssistant);
    await openTermi(container);

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-backup-action"]'));
    expect(mockModalStore.openModal).toHaveBeenCalledWith('recovery-download');

    markBackupDownloaded(NSEC_PUBKEY);
    flushSync();
    await tick();
    const hint = container.querySelector('[data-testid="termi-hint-backup"]');
    expect(hint).not.toBeNull(); // stays visible as a "done" message this session
    expect(hint.querySelector('[data-testid="termi-hint-backup-action"]')).toBeNull();
  });

  it('shows the relays hint only after the check settles, with working actions', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockRelayListEvent.value = null; // no kind 10002
    const { container } = render(TermiAssistant);
    await openTermi(container);
    expect(container.querySelector('[data-testid="termi-hint-relays"]')).toBeNull(); // not settled

    vi.advanceTimersByTime(5000);
    flushSync();
    await tick();
    expect(container.querySelector('[data-testid="termi-hint-relays"]')).not.toBeNull();

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-relays-action"]'));
    expect(mockPublishDefault).toHaveBeenCalledWith(mockManager.active.signer);

    // action ran → doing state (typing indicator, no buttons)
    flushSync();
    expect(container.querySelector('[data-testid="termi-hint-relays-action"]')).toBeNull();
  });

  it('relays secondary action routes to relay settings', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockRelayListEvent.value = null;
    const { container } = render(TermiAssistant);
    vi.advanceTimersByTime(5000);
    flushSync();
    await openTermi(container);

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-relays-secondary"]'));
    expect(mockGoto).toHaveBeenCalledWith('/settings#relay-settings');
  });

  it('shows the dm hint when the self-check reports absent and backfills on action', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockDmStatus.value = 'absent';
    const { container } = render(TermiAssistant);
    expect(container.querySelector('[data-testid="termi-badge"]')?.textContent.trim()).toBe('1');
    await openTermi(container);

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-dm-action"]'));
    expect(mockEnsureDm).toHaveBeenCalled();
  });

  it('shows the nip05 hint when membership is enabled and the profile has none, action routes to settings', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockMembership.value = { enabled: true, handleDomain: 'edufeed.org' };
    mockProfileEvent.value = { kind: 0, content: JSON.stringify({ name: 'test' }), tags: [] };
    const { container } = render(TermiAssistant);
    await openTermi(container);

    expect(container.querySelector('[data-testid="termi-hint-nip05"]')).not.toBeNull();
    await fireEvent.click(container.querySelector('[data-testid="termi-hint-nip05-action"]'));
    expect(mockGoto).toHaveBeenCalledWith('/settings');
  });

  it('shows no nip05 hint when the profile has one or membership is disabled', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockMembership.value = { enabled: true, handleDomain: 'edufeed.org' };
    let r = render(TermiAssistant);
    await openTermi(r.container);
    expect(r.container.querySelector('[data-testid="termi-hint-nip05"]')).toBeNull();
    r.unmount();

    mockMembership.value = { enabled: false, handleDomain: '' };
    mockProfileEvent.value = { kind: 0, content: JSON.stringify({ name: 'x' }), tags: [] };
    r = render(TermiAssistant);
    await openTermi(r.container);
    expect(r.container.querySelector('[data-testid="termi-hint-nip05"]')).toBeNull();
  });

  it('shows no nip05 hint when its dismiss flag is set', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockMembership.value = { enabled: true, handleDomain: 'edufeed.org' };
    mockProfileEvent.value = { kind: 0, content: JSON.stringify({ name: 'test' }), tags: [] };
    localStorage.setItem(`nip05-hint-dismissed:${EXT_PUBKEY}`, '1');
    const { container } = render(TermiAssistant);
    await openTermi(container);
    expect(container.querySelector('[data-testid="termi-hint-nip05"]')).toBeNull();
  });

  it('renders no launcher badge when everything is set up', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    const { container } = render(TermiAssistant);
    expect(container.querySelector('[data-testid="termi-badge"]')).toBeNull();

    await openTermi(container);
    expect(container.querySelectorAll('[data-testid^="termi-hint-"]').length).toBe(0);
  });
});
