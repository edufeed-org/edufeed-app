// @ts-nocheck
/**
 * LoginWithPrivateKey component tests.
 *
 * Focus: the duplicate-account branch must reuse the existing account object
 * stored in the manager (not pass a freshly constructed one). The previous
 * code crashed inside `manager.setActive(newAccount)` because applesauce's
 * AccountManager looks up by `account.id` and a freshly-built SimpleAccount
 * has a new random nanoid id. The crash was swallowed by the catch-all and
 * shown to users as the misleading "Failed to log in" error.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import LoginWithPrivateKey from '../LoginWithPrivateKey.svelte';

// Fixed 32-byte private key for deterministic tests
const PRIVATE_KEY = new Uint8Array(32).fill(7);
const NSEC = nip19.nsecEncode(PRIVATE_KEY);

// Hoisted mock state, mutated per-test
const mockManager = vi.hoisted(() => ({
  getAccountForPubkey: vi.fn(),
  addAccount: vi.fn(),
  setActive: vi.fn(),
  get accounts() {
    return [];
  },
  get active() {
    return undefined;
  }
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: {
    activeModal: 'privateKey',
    closeModal: vi.fn(),
    openModal: vi.fn()
  }
}));

// Stub the profile loader: returns a never-emitting Observable so the
// component's "fetch profile to use as PM username" effect cleans up silently
// without touching relays or pulling in window.matchMedia from relay-helper.
vi.mock('$lib/loaders/profile.js', () => ({
  loadUserProfile: () => ({
    subscribe: () => ({ unsubscribe: () => {} })
  })
}));

vi.mock('$lib/paraglide/messages', () => ({
  auth_login_private_key_title: () => 'Log in with private key',
  auth_login_private_key_description: () => 'Paste your nsec',
  auth_login_private_key_label: () => 'Private key',
  auth_login_private_key_placeholder: () => 'nsec1...',
  auth_login_private_key_password_label: () => 'Password',
  auth_login_private_key_password_placeholder: () => 'password',
  auth_login_private_key_password_help: () => 'help',
  auth_login_private_key_login_button: () => 'Log in',
  auth_login_private_key_no_account: () => 'No account?',
  auth_login_private_key_error_password_required: () => 'Password required',
  auth_login_private_key_error_decrypt_failed: () => 'Decrypt failed',
  auth_login_private_key_error_invalid_format: () => 'Invalid format',
  auth_login_private_key_error_login_failed: () => 'Failed to log in',
  auth_login_private_key_already_logged_in: () => 'Already logged in — switching',
  auth_login_modal_or: () => 'or',
  common_close: () => 'Close'
}));

// jsdom's HTMLDialogElement does not implement showModal/close. Polyfill them
// so the component's `dialog.close()` call inside the success path works.
beforeEach(() => {
  vi.clearAllMocks();
  mockManager.getAccountForPubkey.mockReset();
  mockManager.addAccount.mockReset();
  mockManager.setActive.mockReset();

  if (typeof HTMLDialogElement !== 'undefined') {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  }
});

/** Helper: type the nsec, click Log in, and let microtasks flush. */
async function submitNsec(container, nsecValue = NSEC) {
  const input = container.querySelector('#nsec-input');
  await fireEvent.input(input, { target: { value: nsecValue } });
  const button = container.querySelector('button.btn-primary');
  await fireEvent.click(button);
  // Allow async getPublicKey() and any post-click effects to resolve
  await new Promise((r) => setTimeout(r, 50));
}

describe('LoginWithPrivateKey', () => {
  it('adds the account and sets it active on first login (no existing match)', async () => {
    mockManager.getAccountForPubkey.mockReturnValue(undefined);
    const onAccountCreated = vi.fn();

    const { container, queryByText } = render(LoginWithPrivateKey, {
      props: { modalId: 'test-modal-1', onAccountCreated }
    });

    await submitNsec(container);

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    // The account passed to addAccount and setActive must be the same fresh object
    expect(mockManager.setActive.mock.calls[0][0]).toBe(mockManager.addAccount.mock.calls[0][0]);

    expect(onAccountCreated).toHaveBeenCalledTimes(1);
    expect(queryByText('Failed to log in')).toBeNull();
    expect(queryByText('Already logged in — switching')).toBeNull();
  });

  it('switches to the EXISTING account ref when the same nsec is logged in twice', async () => {
    // Stub: simulate that the manager already has an account for this pubkey.
    // Crucially, this object has a different id than any newly-built SimpleAccount.
    const existingAccount = { id: 'existing-id', pubkey: 'pk', signer: {} };
    mockManager.getAccountForPubkey.mockReturnValue(existingAccount);
    const onAccountCreated = vi.fn();

    const { container, queryByText, findByText } = render(LoginWithPrivateKey, {
      props: { modalId: 'test-modal-2', onAccountCreated }
    });

    await submitNsec(container);

    // Must NOT add the account again
    expect(mockManager.addAccount).not.toHaveBeenCalled();

    // Must call setActive with the EXISTING account object (same reference),
    // not a newly constructed SimpleAccount with a different id.
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive.mock.calls[0][0]).toBe(existingAccount);

    // Must show the friendly info message and NOT the generic error.
    expect(queryByText('Failed to log in')).toBeNull();
    await findByText('Already logged in — switching');

    // The success callback should still fire so the parent UI updates.
    expect(onAccountCreated).toHaveBeenCalledTimes(1);
  });
});
