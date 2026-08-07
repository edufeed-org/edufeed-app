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
 *  - profile hint when no kind 0 exists after settle; action opens the
 *    profile-edit modal, hidden by an existing profile or the dismiss flag
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
      'termi_hint_dismiss_aria',
      'termi_hint_relays_doing',
      'termi_hint_dm_doing',
      'termi_hint_nip05_title',
      'termi_hint_nip05_body',
      'termi_hint_nip05_cta',
      'termi_hint_profile_title',
      'termi_hint_profile_body',
      'termi_hint_profile_cta',
      'concord_invite_hint_title',
      'concord_invite_hint_body',
      'concord_invite_hint_action',
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
      'dm_relay_banner_customize_cta',
      'termi_hint_nip05_pending_title',
      'termi_hint_nip05_pending_body',
      'termi_hint_nip05_ready_title',
      'termi_hint_nip05_ready_body',
      'termi_hint_nip05_ready_cta',
      'termi_hint_nip05_ready_doing'
    ].map((key) => [key, () => key])
  )
);

const mockGoto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto: mockGoto }));

// The active-user mock must be a genuine Svelte rune signal (not a plain
// object) so the hook's own $effects — which track getActiveUser() the same
// way production's real useActiveUser() does — actually re-run on a
// mid-session account switch, the exact scenario this suite exercises below.
// $state can only be created inside a file the Svelte compiler processes
// (.svelte.js), so the box lives in ./__mocks__/reactive-box.svelte.js and is
// created inside the (async) mock factory — vi.hoisted callbacks run before
// this file's own imports resolve, so they can't reference it directly.
const mockNip44Decrypt = vi.hoisted(() => vi.fn());
// pubkey matches EXT_PUBKEY — the account most nip05 scenarios activate.
const mockManager = vi.hoisted(() => ({
  active: {
    pubkey: 'b'.repeat(64),
    signer: {
      signEvent: vi.fn(),
      nip44: { decrypt: (...args) => mockNip44Decrypt(...args) }
    }
  }
}));
vi.mock('$lib/stores/accounts.svelte', async () => {
  const { createReactiveBox } = await import('./__mocks__/reactive-box.svelte.js');
  const activeUserBox = createReactiveBox(null);
  return {
    useActiveUser: () => () => activeUserBox.value,
    manager: mockManager,
    __activeUserBox: activeUserBox
  };
});

const mockModalStore = vi.hoisted(() => ({ openModal: vi.fn(), closeModal: vi.fn() }));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

// Relay-list check plumbing: the replaceable subscription emits mockRelayListEvent.
const mockRelayListEvent = vi.hoisted(() => ({ value: null }));
const mockProfileEvent = vi.hoisted(() => ({ value: null }));
/** The active user's own kind 1069 membership applications. */
const mockApplicationEvents = vi.hoisted(() => ({ value: [] }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore: {
    // Membership grant detection (nip05 hint) subscribes to the user's own
    // kind 1069 applications.
    timeline: () => ({
      subscribe: (cb) => {
        cb(mockApplicationEvents.value);
        return { unsubscribe: vi.fn() };
      }
    }),
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
  getCommunikeyRelays: () => [],
  hasMailboxRelays: (e) => !!e && (e.tags || []).some((t) => t[0] === 'r')
}));

// Pulled in through the nip05 hint's membership-grant detection.
const mockActionRun = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/loaders/base.js', () => ({
  timedPool: () => ({})
}));
vi.mock('applesauce-loaders/loaders', () => ({
  createTimelineLoader: () => () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: mockActionRun },
  actionRunnerOptimistic: { run: vi.fn() }
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
// Reactive box (see the vi.mock('$lib/stores/accounts.svelte', ...) factory
// above) — tests still just assign mockActiveUser.value like a plain object.
import { __activeUserBox as mockActiveUser } from '$lib/stores/accounts.svelte';

const NSEC_PUBKEY = 'a'.repeat(64);
const EXT_PUBKEY = 'b'.repeat(64);

function signedUpNsecUser() {
  localStorage.setItem(`signed-up-here:${NSEC_PUBKEY}`, '1');
  return { type: 'nsec', pubkey: NSEC_PUBKEY };
}

async function openTermi(container) {
  await fireEvent.click(container.querySelector('[data-testid="termi-launcher"]'));
}

const originalFetch = globalThis.fetch;

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
  mockApplicationEvents.value = [];
  mockNip44Decrypt.mockResolvedValue(JSON.stringify([['response', 'wished_handle', 'maria']]));
  // Keep the grant hook's .well-known check inert unless a test overrides it.
  globalThis.fetch = vi.fn(async () => ({ ok: false }));
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
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

  it('shows the nip05 hint when membership is enabled and the profile has none, action opens the application modal', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockMembership.value = { enabled: true, handleDomain: 'edufeed.org' };
    mockProfileEvent.value = { kind: 0, content: JSON.stringify({ name: 'test' }), tags: [] };
    const { container } = render(TermiAssistant);
    await openTermi(container);

    expect(container.querySelector('[data-testid="termi-hint-nip05"]')).not.toBeNull();
    await fireEvent.click(container.querySelector('[data-testid="termi-hint-nip05-action"]'));
    // The form comes to the user, rather than sending them to /settings to
    // hunt for the membership card and click a second time.
    expect(mockModalStore.openModal).toHaveBeenCalledWith('membershipApply');
    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('one-click activates a granted handle by publishing the profile update', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockMembership.value = {
      enabled: true,
      handleDomain: 'edufeed.org',
      formAddress: `30168:${'a'.repeat(64)}:edufeed-membership`,
      adminPubkeys: ['a'.repeat(64)]
    };
    mockProfileEvent.value = { kind: 0, content: JSON.stringify({ name: 'test' }), tags: [] };
    mockApplicationEvents.value = [
      {
        id: 'app-1',
        kind: 1069,
        pubkey: EXT_PUBKEY,
        created_at: 1,
        content: '<ciphertext>',
        tags: [
          ['a', `30168:${'a'.repeat(64)}:edufeed-membership`],
          ['p', 'a'.repeat(64)],
          ['encrypted']
        ]
      }
    ];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: { maria: EXT_PUBKEY } })
    }));

    const { container } = render(TermiAssistant);
    // Let the decrypt → .well-known chain resolve (microtasks, not timers).
    for (let i = 0; i < 6; i++) await Promise.resolve();
    flushSync();
    await tick();
    await openTermi(container);

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-nip05-action"]'));
    expect(mockActionRun).toHaveBeenCalledWith(expect.anything(), {
      nip05: 'maria@edufeed.org'
    });
    expect(mockGoto).not.toHaveBeenCalled();
  });

  it('routes Activate to settings when the user has no kind 0 profile yet', async () => {
    // UpdateProfile throws without an existing profile — the one-click must
    // not fire-and-swallow that; it hands over to the settings flow instead.
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockMembership.value = {
      enabled: true,
      handleDomain: 'edufeed.org',
      formAddress: `30168:${'a'.repeat(64)}:edufeed-membership`,
      adminPubkeys: ['a'.repeat(64)]
    };
    mockProfileEvent.value = null; // no kind 0
    mockApplicationEvents.value = [
      {
        id: 'app-1',
        kind: 1069,
        pubkey: EXT_PUBKEY,
        created_at: 1,
        content: '<ciphertext>',
        tags: [
          ['a', `30168:${'a'.repeat(64)}:edufeed-membership`],
          ['p', 'a'.repeat(64)],
          ['encrypted']
        ]
      }
    ];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ names: { maria: EXT_PUBKEY } })
    }));

    const { container } = render(TermiAssistant);
    vi.advanceTimersByTime(5000); // profile check settles via timeout
    for (let i = 0; i < 6; i++) await Promise.resolve();
    flushSync();
    await tick();
    await openTermi(container);

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-nip05-action"]'));
    expect(mockGoto).toHaveBeenCalledWith('/settings');
    expect(mockActionRun).not.toHaveBeenCalled();
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

  it('shows the profile hint when no kind 0 exists after settle, action opens the profile modal', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockProfileEvent.value = null; // no kind 0 anywhere
    const { container } = render(TermiAssistant);
    await openTermi(container);
    // Not settled yet: a missing profile is only concluded after the timeout.
    expect(container.querySelector('[data-testid="termi-hint-profile"]')).toBeNull();

    vi.advanceTimersByTime(5000);
    flushSync();
    await tick();
    expect(container.querySelector('[data-testid="termi-hint-profile"]')).not.toBeNull();

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-profile-action"]'));
    expect(mockModalStore.openModal).toHaveBeenCalledWith('profile', {
      profile: {},
      pubkey: EXT_PUBKEY
    });
  });

  it('shows no profile hint when a kind 0 exists or the dismiss flag is set', async () => {
    // Kind 0 present (beforeEach default fixture) → no hint even after settle.
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    let r = render(TermiAssistant);
    vi.advanceTimersByTime(5000);
    flushSync();
    await openTermi(r.container);
    expect(r.container.querySelector('[data-testid="termi-hint-profile"]')).toBeNull();
    r.unmount();

    // Missing kind 0 but dismissed for this pubkey → no hint.
    mockProfileEvent.value = null;
    localStorage.setItem(`profile-hint-dismissed:${EXT_PUBKEY}`, '1');
    r = render(TermiAssistant);
    vi.advanceTimersByTime(5000);
    flushSync();
    await openTermi(r.container);
    expect(r.container.querySelector('[data-testid="termi-hint-profile"]')).toBeNull();
  });

  it('renders no launcher badge when everything is set up', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    const { container } = render(TermiAssistant);
    expect(container.querySelector('[data-testid="termi-badge"]')).toBeNull();

    await openTermi(container);
    expect(container.querySelectorAll('[data-testid^="termi-hint-"]').length).toBe(0);
  });

  it('dismissing an open hint removes it and persists the per-account flag', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockDmStatus.value = 'absent';
    const { container } = render(TermiAssistant);
    await openTermi(container);
    expect(container.querySelector('[data-testid="termi-hint-dm"]')).not.toBeNull();

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-dm-dismiss"]'));
    expect(container.querySelector('[data-testid="termi-hint-dm"]')).toBeNull();
    expect(localStorage.getItem(`dm-relay-banner-dismissed:${EXT_PUBKEY}`)).toBe('1');
  });

  it('resets session-dismissed hints on account switch', async () => {
    mockActiveUser.value = { type: 'extension', pubkey: EXT_PUBKEY };
    mockDmStatus.value = 'absent';
    const { container } = render(TermiAssistant);
    await openTermi(container);
    expect(container.querySelector('[data-testid="termi-hint-dm"]')).not.toBeNull();

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-dm-dismiss"]'));
    expect(container.querySelector('[data-testid="termi-hint-dm"]')).toBeNull();

    // Switch to a different account with no dismiss flag of its own: the
    // session-local dismissed Set from account B must not leak and hide C's
    // legitimately open hint.
    mockActiveUser.value = { type: 'extension', pubkey: 'c'.repeat(64) };
    flushSync();
    await tick();
    expect(container.querySelector('[data-testid="termi-hint-dm"]')).not.toBeNull();
  });

  it('dismissing a done card removes it without writing any dismiss flag', async () => {
    mockActiveUser.value = signedUpNsecUser();
    const { container } = render(TermiAssistant);
    await openTermi(container);

    markBackupDownloaded(NSEC_PUBKEY);
    flushSync();
    await tick();
    expect(container.querySelector('[data-testid="termi-hint-backup"]')).not.toBeNull();

    await fireEvent.click(container.querySelector('[data-testid="termi-hint-backup-dismiss"]'));
    expect(container.querySelector('[data-testid="termi-hint-backup"]')).toBeNull();
    expect(localStorage.getItem(`backup-banner-dismissed:${NSEC_PUBKEY}`)).toBeNull();
  });
});
