// @ts-nocheck
/**
 * LoginModal component tests.
 *
 * Covers:
 *  - Extension login branch's duplicate handling
 *  - Restructured normie-friendly layout: saved accounts on top, primary
 *    "Create your account" CTA, then a divider + section with the three
 *    legacy methods all visible (no disclosure to expand).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import LoginModal from '../LoginModal.svelte';

vi.mock('../AccountProfile.svelte', async () => {
  const mock = await import('./__mocks__/AccountProfileMock.svelte');
  return { default: mock.default };
});

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
  auth_login_modal_create_account_cta: () => 'Create your account',
  auth_login_modal_existing_account: () => 'Already have a Nostr account?',
  auth_login_modal_extension_error_missing: () => 'No browser extension found.',
  auth_login_modal_extension_error_generic: () => 'Could not connect to extension.',
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
  // Use data-testid so the test survives future reordering of method buttons.
  const button = container.querySelector('[data-testid="login-method-extension"]');
  await fireEvent.click(/** @type {HTMLElement} */ (button));
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

  it('retries getPublicKey once after a "Receiving end does not exist" error (MV3 dormant SW)', async () => {
    // nos2x/Alby on Chrome MV3 commonly fail the very first call after the
    // background service worker idles out, then succeed on retry. Simulate
    // that and assert we recover transparently rather than showing an error.
    const portClosed = new Error(
      'nos2x: Could not establish connection. Receiving end does not exist.'
    );
    mockExtensionSigner.getPublicKey
      .mockRejectedValueOnce(portClosed)
      .mockResolvedValueOnce('extension-pk');
    mockManager.getAccountForPubkey.mockReturnValue(undefined);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-retry-1' } });

    await clickExtension(container);
    // Wait out the 250ms retry delay
    await new Promise((r) => setTimeout(r, 350));

    // No visible error
    const alert = container.querySelector('[data-testid="extension-error"]');
    expect(alert).toBeNull();
    // Account was added on the retry
    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
    expect(mockManager.setActive).toHaveBeenCalledTimes(1);
    expect(mockModalStore.closeModal).toHaveBeenCalled();
  });

  it('surfaces a visible error when the extension is missing instead of hanging silently', async () => {
    // ExtensionMissingError is what applesauce-signers throws when window.nostr
    // is absent. Previously this rejection was unhandled and the modal looked
    // frozen — see the LoginModal createSigner try/catch.
    const err = new Error('Signer extension missing');
    err.name = 'ExtensionMissingError';
    mockExtensionSigner.getPublicKey.mockRejectedValueOnce(err);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-err-1' } });

    await clickExtension(container);

    // Modal stayed open
    expect(mockModalStore.closeModal).not.toHaveBeenCalled();
    // No account was added
    expect(mockManager.addAccount).not.toHaveBeenCalled();
    // Visible error in the section
    const alert = container.querySelector('[data-testid="extension-error"]');
    expect(alert, 'Extension error alert should render').not.toBeNull();
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

describe('LoginModal — restructured normie-friendly layout', () => {
  it('shows the primary "Create your account" CTA prominently', async () => {
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-3' } });

    const cta = container.querySelector('[data-testid="signup-primary-cta"]');
    expect(cta, 'Primary signup CTA should be present').not.toBeNull();
  });

  it('renders the three legacy methods visibly under an "Already have…" divider', async () => {
    const { container } = render(LoginModal, { props: { modalId: 'login-modal-4' } });

    // The disclosure was dropped. Returning users (extension/nsec/bunker)
    // need their option without a click.
    const section = container.querySelector('section[data-testid="other-signin-methods"]');
    expect(section, 'Legacy methods section should render directly').not.toBeNull();

    // No <details> wrapper anywhere — assert it's truly gone.
    const details = container.querySelector('details[data-testid="other-signin-methods"]');
    expect(details).toBeNull();

    // All three method buttons present.
    const insideButtons = section?.querySelectorAll('button.btn');
    expect(insideButtons?.length).toBe(3);
  });

  it('renders saved accounts above the primary CTA when present', async () => {
    // Override useAccounts mock for this test only.
    const accounts = [
      { id: 'acc-1', pubkey: 'p1' },
      { id: 'acc-2', pubkey: 'p2' }
    ];
    const mod = await import('$lib/stores/accounts.svelte.js');
    const original = mod.useAccounts;
    // @ts-ignore
    mod.useAccounts = () => () => accounts;

    try {
      const { container } = render(LoginModal, { props: { modalId: 'login-modal-5' } });

      const savedRows = container.querySelectorAll('[data-testid="saved-account-mock"]');
      expect(savedRows.length).toBe(2);

      const cta = container.querySelector('[data-testid="signup-primary-cta"]');
      expect(cta).not.toBeNull();

      // DOM order: first saved-account-mock should appear before the CTA.
      const first = savedRows[0];
      const cmp = first.compareDocumentPosition(/** @type {Node} */ (cta));
      // Node.DOCUMENT_POSITION_FOLLOWING === 4 — cta follows first saved row
      expect(cmp & 4).toBeTruthy();
    } finally {
      // @ts-ignore
      mod.useAccounts = original;
    }
  });

  it('legacy Extension button is clickable without expanding anything', async () => {
    mockManager.getAccountForPubkey.mockReturnValue(undefined);

    const { container } = render(LoginModal, { props: { modalId: 'login-modal-6' } });

    const extensionButton = container.querySelector('[data-testid="login-method-extension"]');
    await fireEvent.click(/** @type {HTMLElement} */ (extensionButton));
    await new Promise((r) => setTimeout(r, 50));

    expect(mockManager.addAccount).toHaveBeenCalledTimes(1);
  });
});
