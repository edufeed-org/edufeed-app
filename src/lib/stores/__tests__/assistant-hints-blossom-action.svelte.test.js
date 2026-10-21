// @ts-nocheck
/** @vitest-environment jsdom */
/* eslint-disable no-undef -- $effect is a Svelte rune, available in .svelte.js context */
// Termi's two Blossom storage hints for a closed deployment server: when
// they show, what one click publishes (kind 10063 order), and where
// customize/dismiss go. The visibility matrix itself is covered by the pure
// helper tests (deriveBlossomHints).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const gotoMock = vi.hoisted(() => vi.fn());
const openModalMock = vi.hoisted(() => vi.fn());
const activateMock = vi.hoisted(() => vi.fn(async () => 'activated'));
const grantState = vi.hoisted(() => ({
  state: /** @type {'none' | 'pending' | 'granted'} */ ('none'),
  address: ''
}));
const profileState = vi.hoisted(() => ({ nip05s: /** @type {string[]} */ ([]) }));

const cfg = vi.hoisted(() => ({
  membership: /** @type {any} */ ({ enabled: true, handleDomain: 'edufeed.org' }),
  blossom: /** @type {any} */ ({ gated: true, publicServers: ['https://blossom.primal.net'] }),
  defaultBlossomServers: ['https://blossom.edufeed.org/']
}));
const listState = vi.hoisted(() => ({ servers: /** @type {string[] | null} */ (null) }));
const eligibilityState = vi.hoisted(() => ({ value: 'eligible' }));
const saveMock = vi.hoisted(() => vi.fn(async () => ({})));
const flagState = vi.hoisted(() => ({ upgrade: false, public: false }));

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
    replaceable: (/** @type {number} */ kind) => ({
      subscribe(/** @type {(event: any) => void} */ cb) {
        if (kind === 0) cb({ kind: 0, pubkey: 'user-pub', content: '{}', tags: [] });
        if (kind === 10063 && listState.servers) {
          cb({
            kind: 10063,
            pubkey: 'user-pub',
            tags: listState.servers.map((u) => ['server', u])
          });
        }
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
  isNip05HintDismissed: () => false,
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
      return cfg.membership;
    },
    get blossom() {
      return cfg.blossom;
    },
    get defaultBlossomServers() {
      return cfg.defaultBlossomServers;
    }
  }
}));

vi.mock('$lib/loaders/blossom-server-loader.js', () => ({
  createBlossomServerLoader: () => () => () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));
vi.mock('$lib/services/blossom-settings-service.js', () => ({
  parseBlossomServerEvent: (/** @type {any} */ event) =>
    (event?.tags ?? [])
      .filter((/** @type {string[]} */ t) => t[0] === 'server')
      .map((/** @type {string[]} */ t) => ({ url: t[1] })),
  getDefaultBlossomServers: () => cfg.defaultBlossomServers,
  getPublicBlossomServers: () => cfg.blossom.publicServers,
  saveBlossomServers: (/** @type {any[]} */ ...args) => saveMock(...args)
}));
vi.mock('$lib/stores/blossom-eligibility.svelte.js', () => ({
  initBlossomEligibility: () => {},
  getBlossomEligibility: () => eligibilityState.value
}));
vi.mock('$lib/stores/blossom-hint-flags.svelte.js', () => ({
  isBlossomUpgradeHintDismissed: () => flagState.upgrade,
  markBlossomUpgradeHintDismissed: () => {
    flagState.upgrade = true;
  },
  isBlossomPublicHintDismissed: () => flagState.public,
  markBlossomPublicHintDismissed: () => {
    flagState.public = true;
  }
}));

import { useAssistantHints } from '$lib/stores/assistant-hints.svelte.js';

/** Run `fn` against a live hints hook inside an effect root; the kind 10063
 *  settle timer (5 s) is advanced so "no list" is a conclusion, not a wait. */
function withHints(/** @type {(hints: any) => void} */ fn) {
  /** @type {any} */
  let hints;
  const cleanup = $effect.root(() => {
    hints = useAssistantHints();
  });
  flushSync();
  vi.advanceTimersByTime(5001);
  flushSync();
  fn(hints);
  cleanup();
}

/** @param {any} hints @param {string} id */
const statusOf = (hints, id) => hints.getHints().find((/** @type {any} */ h) => h.id === id);

describe('assistant blossom hints', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gotoMock.mockClear();
    openModalMock.mockClear();
    saveMock.mockClear();
    listState.servers = null;
    eligibilityState.value = 'eligible';
    flagState.upgrade = false;
    flagState.public = false;
    cfg.blossom = { gated: true, publicServers: ['https://blossom.primal.net'] };
    cfg.membership = { enabled: true, handleDomain: 'edufeed.org' };
  });
  afterEach(() => vi.useRealTimers());

  it('is silent when the deployment has no gate', () => {
    cfg.blossom = { gated: false, publicServers: [] };
    withHints((hints) => {
      expect(statusOf(hints, 'blossomUpgrade')).toBeUndefined();
      expect(statusOf(hints, 'blossomPublic')).toBeUndefined();
    });
  });

  it('upgrade: eligible without a list → open; one click publishes defaults-first', () => {
    listState.servers = ['https://mine.example'];
    withHints((hints) => {
      expect(statusOf(hints, 'blossomUpgrade')?.status).toBe('open');
      hints.runHint('blossomUpgrade');
      expect(saveMock).toHaveBeenCalledWith(
        [{ url: 'https://blossom.edufeed.org/' }, { url: 'https://mine.example' }],
        'user-pub'
      );
      flushSync();
      expect(statusOf(hints, 'blossomUpgrade')?.status).toBe('doing');
    });
  });

  it('upgrade: a list already led by the deployment server shows nothing', () => {
    listState.servers = ['https://blossom.edufeed.org'];
    withHints((hints) => {
      expect(statusOf(hints, 'blossomUpgrade')).toBeUndefined();
    });
  });

  it('public: ineligible pointing at the gated server → open with the member variant; one click moves public first', () => {
    eligibilityState.value = 'ineligible';
    listState.servers = ['https://blossom.edufeed.org/', 'https://mine.example'];
    withHints((hints) => {
      const hint = statusOf(hints, 'blossomPublic');
      expect(hint?.status).toBe('open');
      expect(hint?.variant).toBe('member');
      expect(statusOf(hints, 'blossomUpgrade')).toBeUndefined();
      hints.runHint('blossomPublic');
      expect(saveMock).toHaveBeenCalledWith(
        [{ url: 'https://blossom.primal.net' }, { url: 'https://mine.example' }],
        'user-pub'
      );
    });
  });

  it('public: plain variant when the deployment grants no handles', () => {
    eligibilityState.value = 'ineligible';
    listState.servers = ['https://blossom.edufeed.org/'];
    cfg.membership = { enabled: false, handleDomain: '' };
    withHints((hints) => {
      expect(statusOf(hints, 'blossomPublic')?.variant).toBe('plain');
    });
  });

  it('ineligible without a list → nothing (defaults already route publicly)', () => {
    eligibilityState.value = 'ineligible';
    withHints((hints) => {
      expect(statusOf(hints, 'blossomPublic')).toBeUndefined();
      expect(statusOf(hints, 'blossomUpgrade')).toBeUndefined();
    });
  });

  it('customize navigates to the settings anchor; dismiss persists per flag', () => {
    listState.servers = ['https://mine.example'];
    withHints((hints) => {
      hints.customizeHint('blossomUpgrade');
      expect(gotoMock).toHaveBeenCalledWith('/settings#blossom-settings');
      expect(statusOf(hints, 'blossomUpgrade')?.status).toBe('open');
      hints.dismissHint('blossomUpgrade');
      flushSync();
      expect(flagState.upgrade).toBe(true);
      expect(statusOf(hints, 'blossomUpgrade')).toBeUndefined();
    });
  });
});
