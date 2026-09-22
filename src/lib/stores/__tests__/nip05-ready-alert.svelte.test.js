// @ts-nocheck
/**
 * App-wide "your handle is ready" alert (issue: the NIP-05 grant was only
 * visible inside the Termi assistant). One module-level store feeds the bell,
 * the inbox rows and Termi's hint, and owns the one-click activation.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const gotoMock = vi.hoisted(() => vi.fn());
const openModalMock = vi.hoisted(() => vi.fn());
const actionRunnerRunMock = vi.hoisted(() => vi.fn(async () => ({})));
const updateProfileMock = vi.hoisted(() => vi.fn());
const grantState = vi.hoisted(() => ({ state: 'none', address: '' }));
const profileState = vi.hoisted(() => ({
  event: /** @type {any} */ (null),
  nip05s: /** @type {string[]} */ ([])
}));
const flags = vi.hoisted(() => ({ readyDismissed: false, marked: 0 }));
const accountState = vi.hoisted(() => ({
  active: /** @type {any} */ ({ pubkey: 'user-pub', type: 'nsec' }),
  subscribers: /** @type {Array<(a: any) => void>} */ ([]),
  emit(/** @type {any} */ next) {
    accountState.active = next;
    for (const cb of accountState.subscribers) cb(next);
  }
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (...args) => openModalMock(...args), closeModal: () => {} }
}));
vi.mock('$lib/stores/membership-grant.svelte.js', () => ({
  useMembershipGrantState: () => ({
    getState: () => grantState.state,
    getAddress: () => grantState.address,
    getWishedHandle: () => grantState.address.split('@')[0] || '',
    getResponse: () => null
  })
}));
// `manager` is non-reactive in the app; the store follows `manager.active$`.
// A minimal BehaviorSubject: emits the current account on subscribe, and
// `accountState.emit(next)` pushes a switch to live subscribers.
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    get active() {
      return accountState.active;
    },
    active$: {
      subscribe(cb) {
        accountState.subscribers.push(cb);
        cb(accountState.active);
        return {
          unsubscribe: () => {
            accountState.subscribers = accountState.subscribers.filter((s) => s !== cb);
          }
        };
      }
    }
  }
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    replaceable: (kind) => ({
      subscribe(cb) {
        if (kind === 0) cb(profileState.event);
        return { unsubscribe: () => {} };
      }
    })
  }
}));
vi.mock('$lib/helpers/nip05-verify.js', () => ({
  getProfileNip05s: () => profileState.nip05s
}));
vi.mock('$lib/stores/nip05-hint-flags.svelte.js', () => ({
  isNip05ReadyHintDismissed: () => flags.readyDismissed,
  markNip05ReadyHintDismissed: () => {
    flags.readyDismissed = true;
    flags.marked++;
  }
}));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: (...args) => actionRunnerRunMock(...args) }
}));
vi.mock('applesauce-actions/actions', () => ({ UpdateProfile: updateProfileMock }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get membership() {
      return { enabled: true, handleDomain: 'edufeed.org' };
    }
  }
}));

import {
  initNip05ReadyAlert,
  stopNip05ReadyAlert,
  getNip05ReadyAlert,
  getNip05ReadyCount,
  getHandleGrant,
  activateGrantedHandle,
  dismissNip05ReadyAlert,
  isActivatingHandle
} from '$lib/stores/nip05-ready-alert.svelte.js';

const ADDRESS = 'maria@edufeed.org';
const PROFILE = { kind: 0, pubkey: 'user-pub', content: '{}', tags: [] };

beforeEach(() => {
  vi.useFakeTimers();
  gotoMock.mockClear();
  openModalMock.mockClear();
  actionRunnerRunMock.mockClear();
  actionRunnerRunMock.mockImplementation(async () => ({}));
  grantState.state = 'granted';
  grantState.address = ADDRESS;
  profileState.event = PROFILE;
  profileState.nip05s = [];
  flags.readyDismissed = false;
  flags.marked = 0;
  accountState.active = { pubkey: 'user-pub', type: 'nsec' };
  accountState.subscribers = [];
});

afterEach(() => {
  stopNip05ReadyAlert();
  vi.useRealTimers();
});

/** Start detection and wait for the store's lazy imports to settle. */
async function start() {
  initNip05ReadyAlert();
  await settle();
}

/** Flush pending dynamic imports (grant hook / action runner) and effects. */
async function settle() {
  await vi.dynamicImportSettled();
  flushSync();
}

describe('nip05 ready alert', () => {
  it('is silent before the profile settled, then alerts once the kind 0 arrived', async () => {
    profileState.event = null;
    await start();
    expect(getNip05ReadyAlert()).toBeNull();
    expect(getNip05ReadyCount()).toBe(0);
    // No kind 0 at all — after the settle timeout the grant still counts as
    // not activated, so the alert shows (activation then routes to settings).
    vi.advanceTimersByTime(5000);
    flushSync();
    expect(getNip05ReadyAlert()).toEqual({ address: ADDRESS, hasOther: false, hasProfile: false });
    expect(getNip05ReadyCount()).toBe(1);
  });

  it('alerts while the granted address is not on the profile yet', async () => {
    await start();
    expect(getNip05ReadyAlert()).toEqual({ address: ADDRESS, hasOther: false, hasProfile: true });
    expect(getHandleGrant()).toMatchObject({
      state: 'granted',
      address: ADDRESS,
      activated: false
    });
  });

  it('stays quiet while the application is only pending, or never made', async () => {
    grantState.state = 'pending';
    await start();
    expect(getNip05ReadyAlert()).toBeNull();
    stopNip05ReadyAlert();
    grantState.state = 'none';
    await start();
    expect(getNip05ReadyAlert()).toBeNull();
  });

  it('goes quiet once the address is on the profile (case-insensitive)', async () => {
    profileState.nip05s = ['Maria@Edufeed.org'];
    await start();
    expect(getNip05ReadyAlert()).toBeNull();
    expect(getHandleGrant().activated).toBe(true);
  });

  it('respects the shared ready-hint dismiss flag', async () => {
    flags.readyDismissed = true;
    await start();
    expect(getNip05ReadyAlert()).toBeNull();
  });

  it('reports another address on the profile so callers can route to settings', async () => {
    profileState.nip05s = ['old@example.org'];
    await start();
    expect(getNip05ReadyAlert()).toEqual({ address: ADDRESS, hasOther: true, hasProfile: true });
  });

  it('dismiss sets the flag Termi shares and hides the alert', async () => {
    await start();
    dismissNip05ReadyAlert();
    flushSync();
    expect(flags.marked).toBe(1);
    expect(getNip05ReadyAlert()).toBeNull();
  });

  it('is gone for logged-out users', async () => {
    accountState.active = null;
    await start();
    expect(getNip05ReadyAlert()).toBeNull();
  });

  it('follows login and logout through manager.active$ (manager itself is not reactive)', async () => {
    accountState.active = null;
    await start();
    expect(getNip05ReadyAlert()).toBeNull();
    accountState.emit({ pubkey: 'user-pub', type: 'nsec' });
    await settle();
    expect(getNip05ReadyAlert()).toEqual({ address: ADDRESS, hasOther: false, hasProfile: true });
    accountState.emit(null);
    await settle();
    expect(getNip05ReadyAlert()).toBeNull();
    expect(getHandleGrant().state).toBe('none');
  });
});

describe('activateGrantedHandle', () => {
  it('publishes the address to the profile and opens the confirmation modal', async () => {
    await start();
    const promise = activateGrantedHandle();
    flushSync();
    expect(isActivatingHandle()).toBe(true);
    await settle();
    await expect(promise).resolves.toBe('activated');
    flushSync();
    expect(actionRunnerRunMock).toHaveBeenCalledWith(updateProfileMock, { nip05: ADDRESS });
    expect(openModalMock).toHaveBeenCalledWith('nip05Activated', { address: ADDRESS });
    expect(isActivatingHandle()).toBe(false);
  });

  it('hands over to settings when another address exists (replace-or-add lives there)', async () => {
    profileState.nip05s = ['old@example.org'];
    await start();
    await expect(activateGrantedHandle()).resolves.toBe('settings');
    expect(gotoMock).toHaveBeenCalledWith('/settings');
    expect(actionRunnerRunMock).not.toHaveBeenCalled();
    expect(openModalMock).not.toHaveBeenCalled();
  });

  it('hands over to settings when there is no kind 0 to update', async () => {
    profileState.event = null;
    await start();
    vi.advanceTimersByTime(5000);
    flushSync();
    await expect(activateGrantedHandle()).resolves.toBe('settings');
    expect(gotoMock).toHaveBeenCalledWith('/settings');
  });

  it('reports failure without a modal when publishing throws', async () => {
    actionRunnerRunMock.mockImplementation(async () => {
      throw new Error('relay down');
    });
    await start();
    await expect(activateGrantedHandle()).resolves.toBe('failed');
    expect(openModalMock).not.toHaveBeenCalled();
    expect(isActivatingHandle()).toBe(false);
  });

  it('does nothing without a granted address', async () => {
    grantState.state = 'pending';
    grantState.address = '';
    await start();
    await expect(activateGrantedHandle()).resolves.toBe('noop');
    expect(actionRunnerRunMock).not.toHaveBeenCalled();
  });
});
