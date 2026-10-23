/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
// The Termi backup hint after issue ddce9cc0 (C): it stays until the file
// was downloaded. The "x" hides it for the session only — the old permanent
// "Später" flag let a never-backed-up key go silent forever. Harness copied
// from assistant-hints-nip05-action (the TermiAssistant component suite is
// broken on main by a stale mock, so the hook is pinned here).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const gotoMock = vi.hoisted(() => vi.fn());
const openModalMock = vi.hoisted(() => vi.fn());
const activateMock = vi.hoisted(() => vi.fn(async () => 'activated'));
const grantState = vi.hoisted(() => ({
  state: /** @type {'none' | 'pending' | 'granted'} */ ('none'),
  address: ''
}));
const profileState = vi.hoisted(() => ({ nip05s: /** @type {string[]} */ ([]) }));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: {
    get activeModal() {
      return 'none';
    },
    openModal: (/** @type {any} */ type, /** @type {any} */ ...rest) =>
      openModalMock(type, ...rest),
    closeModal: () => {}
  }
}));
vi.mock('$lib/stores/nip05-ready-alert.svelte.js', () => ({
  initNip05ReadyAlert: () => {},
  getHandleGrant: () => ({
    state: grantState.state,
    address: grantState.address,
    activated: false,
    hasOther: false,
    hasProfile: true,
    profileSettled: true
  }),
  activateGrantedHandle: () => activateMock()
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'user-pub', type: 'nsec' }),
  manager: { active: { pubkey: 'user-pub', signer: {} } }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: {},
  eventStore: {
    // A kind 0 exists — otherwise the 'ready' path bails to settings because
    // UpdateProfile has nothing to update.
    replaceable: (/** @type {number} */ kind) => ({
      subscribe(/** @type {(event: any) => void} */ cb) {
        if (kind === 0) cb({ kind: 0, pubkey: 'user-pub', content: '{}', tags: [] });
        return { unsubscribe: () => {} };
      }
    })
  }
}));
vi.mock('$lib/loaders/relay-list-loader.js', () => ({
  createRelayListLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getRelayListLookupRelays: () => [],
  // Needed by the joinRequests hint's joined-communities lane; empty keeps it inert.
  getWriteRelays: async () => []
}));
// The hints chain (join-request-alerts → my-groups → loaders/index) pulls in
// every loader module, and each one reads its relay list at import time, so
// the mock keeps the real helper and only pins what this suite cares about.
vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  getDefaultRelayList: () => [],
  getDefaultDmRelays: () => [],
  hasMailboxRelays: () => true,
  getEventLoaderLookupRelays: () => [],
  getAllLookupRelays: () => [],
  getGroupsRelays: () => [],
  getCommunikeyRelays: () => []
}));
vi.mock('$lib/services/relay-list-backfill.js', () => ({
  publishDefaultRelayList: async () => {}
}));
vi.mock('$lib/services/dm-relay-backfill.js', () => ({ ensureDmRelayList: async () => {} }));
vi.mock('$lib/services/dm-service.svelte.js', () => ({ getDmRelayCheckStatus: () => 'present' }));
const backupState = vi.hoisted(() => ({ downloaded: false }));
vi.mock('$lib/stores/backup-flags.svelte.js', () => ({
  isBackupDownloaded: () => backupState.downloaded,
  markBackupDownloaded: () => {
    backupState.downloaded = true;
  }
}));
vi.mock('$lib/stores/relay-list-flags.svelte.js', () => ({
  isRelayListBannerDismissed: () => true,
  markRelayListBannerDismissed: () => {}
}));
vi.mock('$lib/stores/dm-relay-flags.svelte.js', () => ({
  isDmRelayBannerDismissed: () => true,
  markDmRelayBannerDismissed: () => {}
}));
vi.mock('$lib/stores/nip05-hint-flags.svelte.js', () => ({
  isNip05HintDismissed: () => false,
  markNip05HintDismissed: () => {},
  isNip05ReadyHintDismissed: () => false,
  markNip05ReadyHintDismissed: () => {}
}));
// The hints hook also starts the Blossom eligibility store, which follows
// `manager.active$` — not part of this suite's accounts stub.
vi.mock('$lib/stores/blossom-eligibility.svelte.js', () => ({
  initBlossomEligibility: () => {},
  getBlossomEligibility: () => 'unknown'
}));
vi.mock('$lib/stores/profile-hint-flags.svelte.js', () => ({
  isProfileHintDismissed: () => true,
  markProfileHintDismissed: () => {}
}));
vi.mock('$lib/helpers/nip05-verify.js', () => ({
  getProfileNip05s: () => profileState.nip05s
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return { enabled: true, handleDomain: 'edufeed.org' };
    }
  }
}));

import { useAssistantHints } from '$lib/stores/assistant-hints.svelte.js';

/** Run `fn` against a live hints hook inside an effect root. */
function withHints(/** @type {(hints: any) => void} */ fn) {
  /** @type {any} */
  let hints;
  const cleanup = $effect.root(() => {
    hints = useAssistantHints();
  });
  flushSync();
  fn(hints);
  cleanup();
}

const backupEntry = (/** @type {any} */ hints) =>
  hints.getHints().find((/** @type {any} */ h) => h.id === 'backup');

describe('assistant backup hint (session-only dismissal)', () => {
  beforeEach(() => {
    openModalMock.mockClear();
    localStorage.clear();
    backupState.downloaded = false;
    localStorage.setItem('signed-up-here:user-pub', '1');
  });

  it('is open for a wizard-created nsec account even when the old dismiss flag is set', () => {
    localStorage.setItem('backup-banner-dismissed:user-pub', '1');
    withHints((hints) => {
      expect(backupEntry(hints)?.status).toBe('open');
      expect(hints.getOpenCount()).toBeGreaterThan(0);
    });
  });

  it('dismissing hides it for this session and writes no flag', () => {
    withHints((hints) => {
      hints.dismissHint('backup');
      flushSync();
      expect(backupEntry(hints)).toBeUndefined();
      expect(localStorage.getItem('backup-banner-dismissed:user-pub')).toBeNull();
      expect(localStorage.getItem('backup-downloaded:user-pub')).toBeNull();
    });
  });

  it('its action opens the download, and a downloaded key shows no hint at all', () => {
    withHints((hints) => {
      hints.runHint('backup');
      expect(openModalMock).toHaveBeenCalledWith('recovery-download');
    });
    backupState.downloaded = true;
    withHints((hints) => {
      // nip05 may still be open in this harness; only the backup hint matters.
      expect(backupEntry(hints)).toBeUndefined();
    });
  });

  it('never shows for accounts that did not sign up here', () => {
    localStorage.removeItem('signed-up-here:user-pub');
    withHints((hints) => {
      expect(backupEntry(hints)).toBeUndefined();
    });
  });
});
