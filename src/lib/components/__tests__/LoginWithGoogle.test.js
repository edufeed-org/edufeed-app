// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

const mockService = vi.hoisted(() => ({
  startGoogleLogin: vi.fn(),
  finishGoogleLogin: vi.fn(),
  defaultThreshold: (n) => Math.ceil((n * 7) / 12),
  generateSecretKey: () => new Uint8Array(32).fill(7)
}));
vi.mock('$lib/services/pomegranate.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, ...mockService };
});

const mockBunker = vi.hoisted(() => ({
  connectWithBunkerUrl: vi.fn(),
  registerBunkerAccount: vi.fn()
}));
vi.mock('$lib/helpers/bunker-connection.js', () => mockBunker);

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ pool: {} }));

const mockManager = vi.hoisted(() => ({
  getAccountForPubkey: vi.fn(() => null),
  toJSON: vi.fn(() => [{ id: 'x' }])
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/stores/accounts.svelte.js', () => ({ manager: mockManager }));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'googleLogin',
  closeModal: vi.fn(),
  transitionModal: vi.fn()
}));
vi.mock('$lib/stores/modal.svelte.js', () => ({ modalStore: mockModalStore }));

const mockRuntimeConfig = vi.hoisted(() => ({
  googleLogin: {
    enabled: true,
    centralUrl: 'https://central.test',
    operatorUrls: ['https://op1.test', 'https://op2.test', 'https://op3.test']
  }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: mockRuntimeConfig }));

vi.mock('$lib/helpers/recoveryFile.js', () => ({ downloadRecoveryFile: vi.fn() }));

// A Proxy-returning factory breaks vitest's module-mock interop ("Cannot
// create proxy with a non-object as target or handler"), so build a plain
// object instead — each message function just echoes its own key, same
// semantics the component/tests below rely on.
vi.mock('$lib/paraglide/messages', () => {
  const keys = [
    'auth_login_google_title',
    'auth_login_google_intro',
    'auth_login_google_start',
    'auth_login_google_status_authenticating',
    'auth_login_google_status_creating',
    'auth_login_google_status_connecting',
    'auth_login_google_backup_title',
    'auth_login_google_backup_description',
    'auth_login_google_backup_copy',
    'auth_login_google_backup_copied',
    'auth_login_google_backup_download',
    'auth_login_google_backup_skip',
    'auth_login_google_backup_continue',
    'auth_login_google_error_popup_blocked',
    'auth_login_google_error_popup_closed',
    'auth_login_google_error_generic',
    'common_close'
  ];
  return Object.fromEntries(keys.map((k) => [k, () => k]));
});

import LoginWithGoogle from '../LoginWithGoogle.svelte';

describe('LoginWithGoogle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockManager.getAccountForPubkey.mockReturnValue(null);
    mockManager.toJSON.mockReturnValue([{ id: 'x' }]);
    localStorage.clear();
  });

  it('existing account: logs straight in via the bunker path', async () => {
    mockService.startGoogleLogin.mockResolvedValue({ token: { raw: 'r' }, hasAccount: true });
    mockService.finishGoogleLogin.mockResolvedValue({
      bunkerUrl: 'bunker://x?relay=wss%3A%2F%2Fcentral.test',
      central: 'https://central.test'
    });
    const fakeSigner = {};
    mockBunker.connectWithBunkerUrl.mockResolvedValue({
      signer: fakeSigner,
      pubkey: 'p'.repeat(64)
    });
    const fakeAccount = { metadata: undefined };
    mockBunker.registerBunkerAccount.mockReturnValue({
      account: fakeAccount,
      alreadyExisted: false
    });

    const { getByTestId } = render(LoginWithGoogle, { modalId: 'g1' });
    await fireEvent.click(getByTestId('google-login-start'));

    await waitFor(() => expect(mockBunker.registerBunkerAccount).toHaveBeenCalled());
    // finishGoogleLogin called with null config (no account creation)
    expect(mockService.finishGoogleLogin).toHaveBeenCalledWith(
      'https://central.test',
      { raw: 'r' },
      null
    );
    // account is tagged as a pomegranate account
    expect(fakeAccount.metadata).toEqual({ pomegranateCentral: 'https://central.test' });
    expect(mockModalStore.closeModal).toHaveBeenCalled();
    // manager.accounts$ never emits for a metadata-only mutation, so the
    // component must persist manually after tagging the account — otherwise
    // the Google tag is lost on reload (see LoginWithGoogle.svelte comment).
    expect(mockManager.toJSON).toHaveBeenCalled();
    expect(localStorage.getItem('accounts')).toBe(JSON.stringify([{ id: 'x' }]));
  });

  it('new account: shows the backup step before creating', async () => {
    mockService.startGoogleLogin.mockResolvedValue({ token: { raw: 'r' }, hasAccount: false });
    const { getByTestId } = render(LoginWithGoogle, { modalId: 'g2' });
    await fireEvent.click(getByTestId('google-login-start'));
    await waitFor(() => expect(getByTestId('google-backup-step')).toBeTruthy());
    expect(mockService.finishGoogleLogin).not.toHaveBeenCalled();
  });

  it('new account: skip proceeds to creation and hands off to signup', async () => {
    mockService.startGoogleLogin.mockResolvedValue({ token: { raw: 'r' }, hasAccount: false });
    mockService.finishGoogleLogin.mockResolvedValue({
      bunkerUrl: 'bunker://x?relay=wss%3A%2F%2Fcentral.test',
      central: 'https://central.test'
    });
    mockBunker.connectWithBunkerUrl.mockResolvedValue({ signer: {}, pubkey: 'p'.repeat(64) });
    mockBunker.registerBunkerAccount.mockReturnValue({
      account: { metadata: undefined },
      alreadyExisted: false
    });

    const { getByTestId } = render(LoginWithGoogle, { modalId: 'g3' });
    await fireEvent.click(getByTestId('google-login-start'));
    await waitFor(() => getByTestId('google-backup-step'));
    await fireEvent.click(getByTestId('google-backup-skip'));

    await waitFor(() =>
      expect(mockModalStore.transitionModal).toHaveBeenCalledWith('googleLogin', 'signup', {
        externalSignup: true
      })
    );
    const config = mockService.finishGoogleLogin.mock.calls[0][2];
    expect(config.operators).toEqual(mockRuntimeConfig.googleLogin.operatorUrls);
    expect(config.threshold).toBe(2); // ceil(3*7/12)
    expect(config.secretKey).toBeInstanceOf(Uint8Array);
  });

  it('popup-blocked error is surfaced', async () => {
    const err = new Error('Popup was blocked');
    err.name = 'PomegranatePopupBlockedError';
    mockService.startGoogleLogin.mockRejectedValue(err);
    const { getByTestId, getByText } = render(LoginWithGoogle, { modalId: 'g4' });
    await fireEvent.click(getByTestId('google-login-start'));
    await waitFor(() => expect(getByText('auth_login_google_error_popup_blocked')).toBeTruthy());
  });
});
