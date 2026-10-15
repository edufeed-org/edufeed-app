/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
// The Termi assistant's "your extension cannot encrypt" hint (issue
// acb0250d: keys.band ships no NIP-44, so DMs, private channels and guest
// links fail after the fact). Harness copied from the nip05-action suite;
// the active account is swapped per test through `activeUser`.
//
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
const activeUser = vi.hoisted(() => ({
  value: /** @type {any} */ ({ pubkey: 'user-pub', type: 'nsec', signer: {} })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => activeUser.value,
  manager: {
    get active() {
      return activeUser.value;
    }
  }
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
  createRelayListLoader: () => () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
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
vi.mock('$lib/stores/backup-flags.svelte.js', () => ({
  isBackupDownloaded: () => true,
  isBackupDismissed: () => true,
  markBackupDismissed: () => {}
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
  isNip05HintDismissed: () => true,
  markNip05HintDismissed: () => {},
  isNip05ReadyHintDismissed: () => false,
  markNip05ReadyHintDismissed: () => {}
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
      return { enabled: false, handleDomain: '' };
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

const NIP44 = { encrypt: async () => '', decrypt: async () => '' };
const KEYSBAND = { pubkey: 'ext-pub', type: 'extension', signer: { signEvent: async () => {} } };
const ALBY = { pubkey: 'ext-pub', type: 'extension', signer: { nip44: NIP44 } };

describe('assistant signer hint (extension without NIP-44)', () => {
  beforeEach(() => {
    localStorage.clear();
    gotoMock.mockClear();
    openModalMock.mockClear();
    activeUser.value = { pubkey: 'user-pub', type: 'nsec', signer: { nip44: NIP44 } };
  });

  it('is open for an extension account whose window.nostr has no nip44', () => {
    activeUser.value = KEYSBAND;
    withHints((hints) => {
      expect(hints.getHints()).toEqual([{ id: 'signer', status: 'open' }]);
      expect(hints.getOpenCount()).toBe(1);
    });
  });

  it('is absent for an extension that encrypts and for nsec accounts', () => {
    activeUser.value = ALBY;
    withHints((hints) => {
      expect(hints.getHints().find((/** @type {any} */ h) => h.id === 'signer')).toBeUndefined();
    });
    activeUser.value = { pubkey: 'user-pub', type: 'nsec', signer: {} };
    withHints((hints) => {
      expect(hints.getHints().find((/** @type {any} */ h) => h.id === 'signer')).toBeUndefined();
    });
  });

  it('its action opens the login modal so the user can add another method', () => {
    activeUser.value = KEYSBAND;
    withHints((hints) => {
      hints.runHint('signer');
      expect(openModalMock).toHaveBeenCalledWith('login');
      expect(gotoMock).not.toHaveBeenCalled();
    });
  });

  it('dismissing it persists per account and hides it on the next session', () => {
    activeUser.value = KEYSBAND;
    withHints((hints) => {
      hints.dismissHint('signer');
      flushSync();
      expect(hints.getHints()).toEqual([]);
    });
    withHints((hints) => {
      expect(hints.getHints()).toEqual([]);
    });
    expect(localStorage.getItem('signer-hint-dismissed:ext-pub')).toBe('1');
  });
});
