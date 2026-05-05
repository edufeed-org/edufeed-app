// @ts-nocheck
/**
 * LoginModal component tests — focus on the Extension login branch's
 * duplicate handling (currently a silent no-op).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import LoginModal from '../LoginModal.svelte';

const mockExtensionSigner = vi.hoisted(() => ({
  getPublicKey: vi.fn().mockResolvedValue('extension-pk')
}));

vi.mock('applesauce-signers', () => ({
  ExtensionSigner: function ExtensionSigner() {
    return mockExtensionSigner;
  }
}));

// applesauce-accounts/accounts ExtensionAccount class — keep it lightweight,
// just a class that records pubkey + signer so the test can identify the object.
vi.mock('applesauce-accounts/accounts', () => ({
  ExtensionAccount: class ExtensionAccount {
    /**
     * @param {string} pubkey
     * @param {any} signer
     */
    constructor(pubkey, signer) {
      this.id = `ext-${pubkey}`;
      this.pubkey = pubkey;
      this.signer = signer;
    }
  }
}));

const mockManager = vi.hoisted(() => ({
  getAccountForPubkey: vi.fn(),
  addAccount: vi.fn(),
  setActive: vi.fn()
}));

// LoginModal imports both '$lib/stores/accounts.svelte' and
// '$lib/stores/accounts.svelte.js' — Vitest treats them as distinct paths.
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  signer: { signer: null },
  useAccounts: () => () => []
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  manager: mockManager,
  signer: { signer: null },
  useAccounts: () => () => []
}));

// useUserProfile transitively pulls in relay-helper / app-settings (matchMedia).
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => undefined
}));

const mockModalStore = vi.hoisted(() => ({
  activeModal: 'login',
  closeModal: vi.fn(),
  openModal: vi.fn()
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: mockModalStore
}));

vi.mock('$lib/paraglide/messages', () => ({
  auth_login_modal_add_account: () => 'Add account',
  auth_login_modal_available_accounts: () => 'Available accounts',
  auth_login_modal_choose_method: () => 'Choose method',
  auth_login_modal_extension: () => 'Extension',
  auth_login_modal_nsec: () => 'NSEC',
  auth_login_modal_bunker: () => 'Bunker',
  auth_login_modal_or: () => 'or',
  auth_login_modal_no_account: () => 'No account?',
  common_close: () => 'Close'
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockManager.getAccountForPubkey.mockReset();
  mockManager.addAccount.mockReset();
  mockManager.setActive.mockReset();
  mockExtensionSigner.getPublicKey.mockResolvedValue('extension-pk');

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

async function clickExtension(container) {
  // The first .join-item button is the Extension one
  const buttons = container.querySelectorAll('.join button.btn');
  await fireEvent.click(buttons[0]);
  await new Promise((r) => setTimeout(r, 50));
}

describe('LoginModal — Extension flow duplicate handling', () => {
  it('switches to the EXISTING account ref when the extension pubkey is already a known account', async () => {
    const existingAccount = { id: 'existing-id', pubkey: 'extension-pk', signer: {} };
    mockManager.getAccountForPubkey.mockReturnValue(existingAccount);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-1' } });

    await clickExtension(container);

    // Must NOT add a new account
    expect(mockManager.addAccount).not.toHaveBeenCalled();
    // Must call setActive with the EXISTING reference (current code does nothing)
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive.mock.calls[0][0]).toBe(existingAccount);
    // Modal closed
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });

  it('adds and activates a new account on first extension login', async () => {
    mockManager.getAccountForPubkey.mockReturnValue(undefined);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-2' } });

    await clickExtension(container);

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    // The same fresh account object is passed to both
    expect(mockManager.setActive.mock.calls[0][0]).toBe(mockManager.addAccount.mock.calls[0][0]);
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });
});
