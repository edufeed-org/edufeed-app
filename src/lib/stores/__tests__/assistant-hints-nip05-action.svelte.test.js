/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
// Where the Termi assistant's nip05 CTA actually sends the user. The hint's
// visibility matrix is covered by the pure helper tests; this pins the routing:
//
//   apply           → the application modal (no settings detour)
//   ready           → one-click profile update, published in place
//   ready + other   → settings, where replace-or-add is offered
//
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const gotoMock = vi.hoisted(() => vi.fn());
const openModalMock = vi.hoisted(() => vi.fn());
const actionRunnerRunMock = vi.hoisted(() =>
  vi.fn(async (/** @type {any} */ _builder, /** @type {any} */ _options) => ({}))
);
const updateProfileMock = vi.hoisted(() => vi.fn());
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
vi.mock('$lib/stores/membership-grant.svelte.js', () => ({
  useMembershipGrantState: () => ({
    getState: () => grantState.state,
    getAddress: () => grantState.address,
    getWishedHandle: () => grantState.address.split('@')[0] || '',
    getResponse: () => null
  })
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
  createRelayListLoader: () => () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/services/relay-service.svelte.js', () => ({ getRelayListLookupRelays: () => [] }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getDefaultRelayList: () => [],
  getDefaultDmRelays: () => [],
  hasMailboxRelays: () => true
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
  isNip05HintDismissed: () => false,
  markNip05HintDismissed: () => {},
  isNip05ReadyHintDismissed: () => false,
  markNip05ReadyHintDismissed: () => {}
}));
vi.mock('$lib/stores/profile-hint-flags.svelte.js', () => ({
  isProfileHintDismissed: () => true,
  markProfileHintDismissed: () => {}
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: {
    run: (/** @type {any} */ builder, /** @type {any} */ options) =>
      actionRunnerRunMock(builder, options)
  }
}));
vi.mock('applesauce-actions/actions', () => ({ UpdateProfile: updateProfileMock }));
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

describe('assistant nip05 hint action', () => {
  beforeEach(() => {
    gotoMock.mockClear();
    openModalMock.mockClear();
    actionRunnerRunMock.mockClear();
    grantState.state = 'none';
    grantState.address = '';
    profileState.nip05s = [];
  });

  it('opens the application modal instead of navigating to settings', () => {
    withHints((hints) => {
      hints.runHint('nip05');
      expect(openModalMock).toHaveBeenCalledWith('membershipApply');
      expect(gotoMock).not.toHaveBeenCalled();
    });
  });

  it('still opens the modal while an application is pending', () => {
    grantState.state = 'pending';
    withHints((hints) => {
      hints.runHint('nip05');
      expect(openModalMock).toHaveBeenCalledWith('membershipApply');
      expect(gotoMock).not.toHaveBeenCalled();
    });
  });

  it('publishes the granted address to the profile in place', () => {
    grantState.state = 'granted';
    grantState.address = 'maria@edufeed.org';
    withHints((hints) => {
      hints.runHint('nip05');
      expect(actionRunnerRunMock).toHaveBeenCalledWith(updateProfileMock, {
        nip05: 'maria@edufeed.org'
      });
      expect(openModalMock).not.toHaveBeenCalled();
    });
  });

  it('hands over to settings when another nip05 would be overwritten', () => {
    grantState.state = 'granted';
    grantState.address = 'maria@edufeed.org';
    profileState.nip05s = ['maria@other.example'];
    withHints((hints) => {
      hints.runHint('nip05');
      expect(gotoMock).toHaveBeenCalledWith('/settings');
      expect(actionRunnerRunMock).not.toHaveBeenCalled();
    });
  });
});
